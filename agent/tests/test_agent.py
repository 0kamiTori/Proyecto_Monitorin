import hashlib
import hmac
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from smtel_agent.boot import classify, windows_boot
from smtel_agent.transport import (
    CredentialError,
    PermanentReportError,
    Sender,
    Spool,
    flush,
    serialize,
    validate_config,
)


class AgentTests(unittest.TestCase):
    def test_windows_unmounted_partition_has_no_nul_drive_path(self):
        info = {
            "OS": "Windows",
            "SystemDrive": "C:",
            "Firmware": "UEFI",
            "Partitions": [
                {"Disk": 0, "Number": 1, "Drive": "\x00", "Size": 1000, "Used": 0},
                {"Disk": 0, "Number": 2, "Drive": "C", "Size": 10000, "Used": 2000},
            ],
            "Disks": [],
        }
        with patch(
            "smtel_agent.boot.command",
            side_effect=[(True, json.dumps(info)), (False, ""), (False, "")],
        ):
            result = windows_boot("windows")
        self.assertEqual(result["partitions"][0]["mountpoint"], "")
        self.assertEqual(result["partitions"][1]["mountpoint"], "C:\\")
        self.assertEqual(result["bootType"], "UNKNOWN")

    def test_unknown_without_boot_evidence(self):
        self.assertEqual(
            classify([{"id": "active"}], False, "Sin permisos"), ("UNKNOWN", "Sin permisos")
        )
        self.assertEqual(classify([{"id": "active"}], True, ""), ("SINGLE", None))
        self.assertEqual(
            classify([{"id": "active"}, {"id": "secondary"}], False, ""), ("MULTI", None)
        )

    def test_tls_required_except_loopback(self):
        config = {
            "serverUrl": "http://192.168.1.10",
            "equipmentId": "pc",
            "osId": "linux",
            "token": "token",
            "hmacSecret": "secret",
        }
        with self.assertRaises(ValueError):
            validate_config(config)
        self.assertEqual(
            validate_config({**config, "serverUrl": "http://127.0.0.1:4000"})["interval"], 30
        )
        with self.assertRaises(ValueError):
            validate_config({**config, "serverUrl": "https://user:pass@host"})

    def test_persistent_queue_survives_restart_and_failed_delivery(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "queue.sqlite"
            spool = Spool(path)
            report = {"id": "report-1", "observedAt": "2026-10-05T12:00:00Z", "cpu": 20}
            spool.enqueue(report)
            spool.enqueue(report)
            self.assertEqual(spool.count(), 1)
            spool.close()
            spool = Spool(path)
            self.assertEqual(spool.pending()[0][1], serialize(report))

            class OfflineSender:
                def send(self, payload):
                    raise OSError("Offline")

            with self.assertRaises(OSError):
                flush(spool, OfflineSender())
            self.assertEqual(spool.count(), 1)

            class OnlineSender:
                def send(self, payload):
                    return {"duplicate": True}

            self.assertEqual(flush(spool, OnlineSender())[0], 1)
            self.assertEqual(spool.count(), 0)
            spool.close()

    def test_invalid_reports_quarantined_and_revoked_credentials_preserve_queue(self):
        with tempfile.TemporaryDirectory() as folder:
            spool = Spool(Path(folder) / "queue.sqlite")
            spool.enqueue({"id": "invalid"})

            class RejectSender:
                def send(self, payload):
                    raise PermanentReportError("422")

            flush(spool, RejectSender())
            self.assertEqual(spool.count(), 0)
            self.assertEqual(spool.rejected_count(), 1)
            spool.enqueue({"id": "revoked"})

            class RevokedSender:
                def send(self, payload):
                    raise CredentialError("401")

            with self.assertRaises(CredentialError):
                flush(spool, RevokedSender())
            self.assertEqual(spool.count(), 1)
            spool.close()

    def test_signature_matches_exact_utf8_payload(self):
        config = validate_config(
            {
                "serverUrl": "https://example.test",
                "equipmentId": "pc",
                "osId": "linux",
                "token": "token",
                "hmacSecret": "secret",
            }
        )
        sender = Sender(config)
        payload = serialize({"id": "1", "name": "Estación"})

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

            def read(self, *_):
                return b'{"duplicate": false}'

        def check(request, timeout):
            sent_at = request.get_header("X-smtel-sent-at")
            expected = hmac.new(
                b"secret", sent_at.encode() + b"." + payload, hashlib.sha256
            ).hexdigest()
            self.assertEqual(request.get_header("X-smtel-signature"), expected)
            self.assertEqual(request.data, payload)
            return FakeResponse()

        with patch.object(sender.opener, "open", side_effect=check):
            self.assertFalse(sender.send(payload)["duplicate"])


if __name__ == "__main__":
    unittest.main()
