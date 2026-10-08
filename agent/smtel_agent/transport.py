from __future__ import annotations

import hashlib
import hmac
import json
import os
import sqlite3
import ssl
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit


class PermanentReportError(Exception):
    """El servidor rechazó un reporte; se conserva en cuarentena para revisión."""


class CredentialError(Exception):
    """Credencial no válida o revocada: detener envíos hasta corregirla."""


def validate_config(config: dict) -> dict:
    for key in ["serverUrl", "equipmentId", "osId", "token", "hmacSecret"]:
        if not isinstance(config.get(key), str) or not config[key]:
            raise ValueError(f"Falta configuración: {key}")
    parsed = urlsplit(config["serverUrl"])
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    ):
        raise ValueError("Se requiere HTTPS; HTTP solo está permitido en loopback para desarrollo.")
    if (
        parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ValueError(
            "serverUrl debe ser un origen HTTPS sin credenciales, rutas ni parámetros."
        )
    config["interval"] = int(config.get("interval", 30))
    config["storageInterval"] = int(config.get("storageInterval", 300))
    if not 10 <= config["interval"] <= 3600 or not 30 <= config["storageInterval"] <= 86400:
        raise ValueError("Intervalos fuera de rango.")
    return config


def serialize(report: dict) -> bytes:
    return json.dumps(report, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode(
        "utf-8"
    )


class Spool:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, payload BLOB NOT NULL, status TEXT NOT NULL DEFAULT 'queued', error TEXT)"
        )
        self.db.commit()
        if os.name != "nt":
            os.chmod(path, 0o600)

    def enqueue(self, report: dict) -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO reports(id,payload) VALUES (?,?)",
            (report["id"], serialize(report)),
        )
        self.db.commit()

    def pending(self) -> list[tuple[str, bytes]]:
        return self.db.execute(
            "SELECT id,payload FROM reports WHERE status='queued' ORDER BY CASE WHEN rowid=(SELECT MAX(rowid) FROM reports WHERE status='queued') THEN 0 ELSE 1 END,rowid LIMIT 100"
        ).fetchall()

    def acknowledge(self, report_id: str) -> None:
        self.db.execute("DELETE FROM reports WHERE id=?", (report_id,))
        self.db.commit()

    def quarantine(self, report_id: str, error: str) -> None:
        self.db.execute(
            "UPDATE reports SET status='rejected',error=? WHERE id=?", (error, report_id)
        )
        self.db.commit()

    def count(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM reports WHERE status='queued'").fetchone()[0]

    def rejected_count(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM reports WHERE status='rejected'").fetchone()[0]

    def close(self) -> None:
        self.db.close()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Las credenciales no se reenvían a un origen diferente.
        return None


class Sender:
    def __init__(self, config: dict):
        self.config = config
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        self.opener = urllib.request.build_opener(
            NoRedirect(), urllib.request.HTTPSHandler(context=context)
        )

    def send(self, payload: bytes) -> dict:
        sent_at = (
            datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        )
        signature = hmac.new(
            self.config["hmacSecret"].encode(), sent_at.encode() + b"." + payload, hashlib.sha256
        ).hexdigest()
        request = urllib.request.Request(
            self.config["serverUrl"].rstrip("/") + "/api/ingest",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + self.config["token"],
                "X-Smtel-Sent-At": sent_at,
                "X-Smtel-Signature": signature,
            },
            method="POST",
        )
        try:
            with self.opener.open(request, timeout=15) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code in {401, 403}:
                raise CredentialError(
                    f"El servidor rechazó la credencial ({error.code}). Revise enrolamiento, SO y revocación."
                ) from error
            if error.code in {400, 409, 413, 422}:
                raise PermanentReportError(
                    f"Reporte rechazado por el servidor ({error.code})."
                ) from error
            raise


def flush(spool: Spool, sender: Sender) -> tuple[int, dict | None]:
    sent = 0
    last_response = None
    for report_id, payload in spool.pending():
        try:
            response = sender.send(payload)
        except PermanentReportError as error:
            spool.quarantine(report_id, str(error))
            continue
        spool.acknowledge(report_id)
        sent += 1
        last_response = response
    return sent, last_response
