from __future__ import annotations

import copy
import platform
import socket
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil

from .boot import detect_boot


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def technical_file(path: str) -> str:
    try:
        return Path(path).read_text(encoding="utf-8").strip() or "No identificado"
    except OSError:
        return "No identificado"


def network_adapters() -> list[dict[str, Any]]:
    stats = psutil.net_if_stats()
    counters = psutil.net_io_counters(pernic=True)
    adapters = []
    for name, addresses in psutil.net_if_addrs().items():
        status, counter = stats.get(name), counters.get(name)
        adapters.append(
            {
                "name": name,
                "mac": next((a.address for a in addresses if a.family == psutil.AF_LINK), ""),
                "ipv4": [a.address for a in addresses if a.family == socket.AF_INET],
                "ipv6": [a.address for a in addresses if a.family == socket.AF_INET6],
                "up": bool(status and status.isup),
                "speedMbps": max(0, status.speed) if status else 0,
                "bytesSent": counter.bytes_sent if counter else 0,
                "bytesReceived": counter.bytes_recv if counter else 0,
            }
        )
    return adapters


class Collector:
    def __init__(self, equipment_id: str, os_id: str, storage_interval: int = 300):
        self.equipment_id = equipment_id
        self.os_id = os_id
        self.storage_interval = storage_interval
        self.inventory: dict[str, Any] | None = None
        self.last_inventory = 0.0
        self.last_network = psutil.net_io_counters()
        self.last_network_at = time.monotonic()
        psutil.cpu_percent(interval=None)

    def collect(self) -> dict[str, Any]:
        stamp = utc_now()
        ram, swap = psutil.virtual_memory(), psutil.swap_memory()
        network, current = psutil.net_io_counters(), time.monotonic()
        elapsed = max(0.001, current - self.last_network_at)
        sent = (
            max(0, int((network.bytes_sent - self.last_network.bytes_sent) / elapsed))
            if network and self.last_network
            else 0
        )
        received = (
            max(0, int((network.bytes_recv - self.last_network.bytes_recv) / elapsed))
            if network and self.last_network
            else 0
        )
        self.last_network, self.last_network_at = network, current
        refresh_inventory = (
            self.inventory is None or current - self.last_inventory >= self.storage_interval
        )
        if refresh_inventory:
            self.inventory = self.collect_inventory(stamp)
            self.last_inventory = current
        inventory = copy.deepcopy(self.inventory)
        inventory["adapters"] = network_adapters()
        # Métricas de almacenamiento basadas en las particiones accesibles.
        disk_usage = []
        for part in inventory["partitions"]:
            if part["mountpoint"]:
                try:
                    usage = psutil.disk_usage(part["mountpoint"])
                    part["totalBytes"], part["usedBytes"] = usage.total, usage.used
                    disk_usage.append(usage.percent)
                except (OSError, PermissionError, ValueError):
                    pass
        for system in inventory["operatingSystems"]:
            if system["active"]:
                system["lastSeen"] = stamp
        report = {
            "id": str(uuid.uuid4()),
            "equipmentId": self.equipment_id,
            "osId": self.os_id,
            "observedAt": stamp,
            "metrics": {
                "cpuPercent": psutil.cpu_percent(interval=None),
                "ramPercent": ram.percent,
                "ramUsedBytes": ram.used,
                "ramAvailableBytes": ram.available,
                "swapUsedBytes": swap.used,
                "diskPercent": max(disk_usage, default=0),
                "networkSentBps": sent,
                "networkReceivedBps": received,
            },
        }
        # Inventario cacheado incluido en cada reporte: recuperable aun después de un fallo inicial.
        report["inventory"] = inventory
        return report

    def collect_inventory(self, stamp: str) -> dict[str, Any]:
        boot = detect_boot(self.os_id)
        partitions = boot.pop("partitions", [])
        for part in psutil.disk_partitions(all=False):
            if any(item["mountpoint"] == part.mountpoint for item in partitions):
                continue
            try:
                usage = psutil.disk_usage(part.mountpoint)
            except (OSError, PermissionError, ValueError):
                continue
            partitions.append(
                {
                    "disk": part.device,
                    "name": part.device,
                    "filesystem": part.fstype or "No identificado",
                    "mountpoint": part.mountpoint,
                    "totalBytes": usage.total,
                    "usedBytes": usage.used,
                    "os": self.os_id if part.mountpoint in {"/", "C:\\"} else None,
                }
            )
        adapters = network_adapters()
        frequency = psutil.cpu_freq()
        return {
            "hostname": socket.gethostname(),
            "manufacturer": boot.pop(
                "manufacturer", technical_file("/sys/class/dmi/id/sys_vendor")
            ),
            "model": boot.pop("model", technical_file("/sys/class/dmi/id/product_name")),
            "serial": boot.pop("serial", technical_file("/sys/class/dmi/id/product_serial")),
            "cpuModel": boot.pop("cpuModel", platform.processor() or "No identificado"),
            "physicalCores": psutil.cpu_count(logical=False) or 1,
            "logicalCores": psutil.cpu_count() or 1,
            "frequencyMHz": boot.pop("frequencyMHz", frequency.current if frequency else 0),
            "architecture": platform.machine() or "UNKNOWN",
            "ramTotalBytes": psutil.virtual_memory().total,
            "bootVerifiedAt": stamp,
            "partitions": partitions,
            "adapters": adapters,
            **boot,
        }
