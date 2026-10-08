"""Verificación local del contrato. No envía datos ni necesita credenciales."""

import json
import platform
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "agent"))
from smtel_agent.collector import Collector

report = Collector("contract-check", platform.system().lower()).collect()
target = root / "tmp" / "validation" / "agent-report.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print("Reporte técnico local generado para verificar el contrato; no se envió al servidor.")
