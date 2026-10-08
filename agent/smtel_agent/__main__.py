import argparse
import json
import logging
import signal
import threading
from pathlib import Path

from .collector import Collector
from .transport import CredentialError, Sender, Spool, flush, validate_config


def main() -> int:
    parser = argparse.ArgumentParser(
        description="SMTEL: telemetría técnica, sin actividad personal ni contenido de archivos"
    )
    parser.add_argument("--config", type=Path, default=Path("config.json"))
    parser.add_argument("--spool", type=Path, default=Path("spool/reports.sqlite"))
    parser.add_argument(
        "--once", action="store_true", help="Recolectar y enviar una única medición"
    )
    parser.add_argument(
        "--inspect",
        action="store_true",
        help="Mostrar inventario local sin enviar ni guardar telemetría",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        config = validate_config(json.loads(args.config.read_text(encoding="utf-8-sig")))
    except (OSError, ValueError) as error:
        logging.error("Configuración inválida: %s", error)
        return 2
    collector = Collector(config["equipmentId"], config["osId"], config["storageInterval"])
    if args.inspect:
        print(json.dumps(collector.collect(), ensure_ascii=False, indent=2))
        return 0
    spool, sender = Spool(args.spool), Sender(config)
    stop = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
    try:
        while not stop.is_set():
            try:
                spool.enqueue(collector.collect())
                sent, response = flush(spool, sender)
                if response and response.get("settings"):
                    config["interval"] = max(
                        10, min(3600, int(response["settings"]["reportingInterval"]))
                    )
                    collector.storage_interval = max(
                        30, min(86400, int(response["settings"]["storageInterval"]))
                    )
                logging.info(
                    "Reportes enviados: %s; pendientes: %s; en cuarentena: %s",
                    sent,
                    spool.count(),
                    spool.rejected_count(),
                )
            except CredentialError as error:
                logging.error("%s Los reportes permanecen almacenados localmente.", error)
                return 3
            except Exception as error:
                logging.warning(
                    "No se pudo completar el envío (%s). La cola se conserva para reintento.",
                    type(error).__name__,
                )
                if args.once:
                    return 1
            if args.once:
                return 0
            stop.wait(config["interval"])
    finally:
        spool.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
