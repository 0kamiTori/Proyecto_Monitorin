"""Detección conservadora: nunca se deduce Single Boot solo del SO activo."""

from __future__ import annotations

import json
import os
import platform
import re
import subprocess
from pathlib import Path
from typing import Any


def command(args: list[str], timeout: int = 15) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, errors="replace", timeout=timeout, check=False
        )
        return result.returncode == 0, result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return False, ""


def installation(
    os_id: str, name: str, version: str, partition: str, active: bool
) -> dict[str, Any]:
    arch = {"AMD64": "x86_64", "aarch64": "ARM64", "arm64": "ARM64"}.get(
        platform.machine(), platform.machine()
    ) or "UNKNOWN"
    return {
        "id": os_id,
        "name": name,
        "version": version or "No identificada",
        "architecture": arch,
        "partition": partition,
        "active": active,
        "inferred": not active,
        "agentInstalled": active,
        "lastSeen": None,
    }


def os_name(description: str) -> str | None:
    for token, name in [
        ("windows", "Windows"),
        ("ubuntu", "Ubuntu"),
        ("debian", "Debian"),
        ("fedora", "Fedora"),
        ("linux", "Linux"),
        ("arch", "Arch Linux"),
        ("opensuse", "openSUSE"),
    ]:
        if token in description.lower():
            return name
    return None


def classify(installed: list[dict], evidence_complete: bool, reason: str) -> tuple[str, str | None]:
    if len(installed) >= 2:
        return "MULTI", None
    if evidence_complete and len(installed) == 1:
        return "SINGLE", None
    return (
        "UNKNOWN",
        reason or "No fue posible verificar todas las entradas de arranque y particiones.",
    )


def linux_boot(active_id: str) -> dict[str, Any]:
    release: dict[str, str] = {}
    try:
        for line in Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                release[key] = value.strip('"')
    except OSError:
        pass
    ok, lsblk = command(
        ["lsblk", "-J", "-b", "-o", "NAME,PATH,TYPE,FSTYPE,SIZE,MOUNTPOINTS,MODEL,ROTA,PARTUUID"]
    )
    devices: list[dict] = []
    try:
        tree = json.loads(lsblk).get("blockdevices", []) if ok else []

        def flatten(items: list[dict], parent_disk: str = "") -> None:
            for item in items:
                disk = (
                    str(item.get("path") or item["name"])
                    if item.get("type") == "disk"
                    else parent_disk
                )
                item["_disk"] = disk
                devices.append(item)
                flatten(item.get("children", []), disk)

        flatten(tree)
    except (ValueError, TypeError):
        ok = False
    root_partition = next(
        (item.get("path", "") for item in devices if "/" in (item.get("mountpoints") or [])), ""
    )
    active_name = release.get("NAME", "Linux")
    installed = [
        installation(
            active_id,
            active_name,
            release.get("VERSION_ID", platform.release()),
            root_partition,
            True,
        )
    ]
    probe_ok, probe = command(["os-prober"])
    if probe_ok:
        for line in probe.splitlines():
            fields = line.split(":")
            if len(fields) >= 3 and fields[0] != root_partition:
                name = os_name(fields[1]) or fields[1]
                installed.append(
                    installation(f"inferred:{fields[0]}", name, fields[1], fields[0], False)
                )
    efi_ok, efi = (
        command(["efibootmgr", "-v"]) if Path("/sys/firmware/efi").exists() else (False, "")
    )
    boot_entries = [line for line in efi.splitlines() if re.match(r"Boot[0-9A-Fa-f]{4}\*?\s", line)]
    os_entries = [line for line in boot_entries if os_name(line)]
    for entry in os_entries:
        name = os_name(entry)
        if name and name not in [os_name(item["name"]) or item["name"] for item in installed]:
            installed.append(
                installation(
                    f"inferred:efi:{entry[:8]}", name, "Inferido de UEFI", "No identificada", False
                )
            )
    grub_readable = False
    for candidate in ["/boot/grub/grub.cfg", "/boot/grub2/grub.cfg"]:
        try:
            grub = Path(candidate).read_text(encoding="utf-8", errors="replace")
            grub_readable = True
            for entry in re.findall(r"menuentry\s+['\"]([^'\"]+)['\"]", grub):
                name = os_name(entry)
                if name and name not in [
                    os_name(item["name"]) or item["name"] for item in installed
                ]:
                    installed.append(
                        installation(
                            f"inferred:grub:{name.lower()}",
                            name,
                            "Inferido de GRUB",
                            "No identificada",
                            False,
                        )
                    )
        except OSError:
            continue
    # os-prober, particiones y gestor accesibles; se evita una certeza falsa.
    complete = ok and probe_ok and (grub_readable or efi_ok and bool(os_entries))
    boot_type, reason = classify(
        installed,
        complete,
        "No se pudo verificar lsblk, os-prober o el gestor de arranque. Revise permisos y particiones cifradas.",
    )
    disks = [
        {
            "name": str(item.get("path") or item["name"]),
            "model": str(item.get("model") or "No identificado"),
            "type": "NVMe" if "nvme" in item["name"] else "HDD" if item.get("rota") else "SSD",
            "totalBytes": int(item.get("size") or 0),
        }
        for item in devices
        if item.get("type") == "disk"
    ]
    partition_metadata = [
        {
            "disk": str(item.get("_disk") or item.get("path") or item["name"]),
            "name": str(item.get("path") or item["name"]),
            "filesystem": str(item.get("fstype") or "No identificado"),
            "mountpoint": next((p for p in item.get("mountpoints") or [] if p), ""),
            "totalBytes": int(item.get("size") or 0),
            "usedBytes": 0,
            "os": next(
                (system["id"] for system in installed if system["partition"] == item.get("path")),
                None,
            ),
        }
        for item in devices
        if item.get("type") in {"part", "lvm", "crypt"}
    ]
    return {
        "firmware": "UEFI" if Path("/sys/firmware/efi").exists() else "BIOS",
        "bootManager": "GRUB / UEFI" if efi_ok else "GRUB" if grub_readable else "No identificado",
        "bootType": boot_type,
        "bootReason": reason,
        "operatingSystems": installed,
        "disks": disks,
        "partitions": partition_metadata,
    }


WINDOWS_INVENTORY = r"""
$ErrorActionPreference = 'Stop'
$cs = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$osinfo = Get-CimInstance Win32_OperatingSystem
$disks = @(Get-Disk | Select-Object Number,FriendlyName,Size,BusType)
$partitions = @(Get-Partition | ForEach-Object {
  $volume = $_ | Get-Volume -ErrorAction SilentlyContinue
  [pscustomobject]@{Disk=$_.DiskNumber;Number=$_.PartitionNumber;Drive=[string]$_.DriveLetter;Size=$_.Size;FileSystem=[string]$volume.FileSystem;Used=([double]$volume.Size-[double]$volume.SizeRemaining)}
})
$firmware = 'UNKNOWN'
try {
  Add-Type 'using System.Runtime.InteropServices; public static class SMTELFirmware { [DllImport("kernel32.dll")] public static extern bool GetFirmwareType(out uint firmwareType); }'
  [uint32]$fw = 0
  if ([SMTELFirmware]::GetFirmwareType([ref]$fw)) { if ($fw -eq 2) {$firmware='UEFI'} elseif ($fw -eq 1) {$firmware='BIOS'} }
} catch {}
[pscustomobject]@{Manufacturer=$cs.Manufacturer;Model=$cs.Model;Serial=$bios.SerialNumber;Cpu=$cpu.Name;Frequency=$cpu.MaxClockSpeed;OS=$osinfo.Caption;Version=$osinfo.Version;SystemDrive=$osinfo.SystemDrive;Firmware=$firmware;Disks=$disks;Partitions=$partitions} | ConvertTo-Json -Depth 6 -Compress
"""


def windows_boot(active_id: str) -> dict[str, Any]:
    ok, output = command(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_INVENTORY],
        timeout=30,
    )
    try:
        info = json.loads(output) if ok else {}
    except ValueError:
        info = {}
    for partition in info.get("Partitions", []):
        drive = str(partition.get("Drive") or "").replace("\x00", "").strip()
        partition["Drive"] = drive.upper() if re.fullmatch(r"[A-Za-z]", drive) else ""
    system_drive = info.get("SystemDrive") or os.environ.get("SystemDrive", "C:")
    installed = [
        installation(
            active_id,
            str(info.get("OS") or "Windows"),
            str(info.get("Version") or platform.version()),
            system_drive,
            True,
        )
    ]
    bcd_ok, bcd = command(["bcdedit.exe", "/enum", "osloader", "/v"])
    firmware_ok, firmware = command(["bcdedit.exe", "/enum", "firmware", "/v"])
    descriptions = 0
    for block in re.split(r"\n\s*\n", bcd + "\n\n" + firmware):
        match = re.search(r"(?:description|descripci[oó]n)\s+(.+)", block, re.IGNORECASE)
        if not match:
            continue
        name = os_name(match.group(1))
        if not name:
            continue
        descriptions += 1
        part = re.search(r"partition=([A-Z]:)", block, re.IGNORECASE)
        partition = part.group(1).upper() if part else "No identificada"
        if name == "Windows" and partition == system_drive:
            continue
        if name == "Windows" and partition == "No identificada" and "bootmgfw" in block.lower():
            continue
        if not any(
            item["partition"] == partition and (os_name(item["name"]) or item["name"]) == name
            for item in installed
        ):
            installed.append(
                installation(
                    f"inferred:bcd:{name.lower()}:{partition}",
                    name,
                    match.group(1).strip(),
                    partition,
                    False,
                )
            )
    complete = (
        bool(info)
        and bcd_ok
        and descriptions > 0
        and (info.get("Firmware") == "BIOS" or firmware_ok)
    )
    boot_type, reason = classify(
        installed,
        complete,
        "No fue posible verificar CIM, particiones o entradas BCD/UEFI. Revise permisos, idioma del gestor y cifrado.",
    )
    disks = [
        {
            "name": f"Disco {item['Number']}",
            "model": str(item.get("FriendlyName") or "No identificado"),
            "type": "NVMe" if item.get("BusType") == 17 else "No identificado",
            "totalBytes": int(item.get("Size") or 0),
        }
        for item in info.get("Disks", [])
    ]
    partitions = [
        {
            "disk": f"Disco {p['Disk']}",
            "name": f"Disco {p['Disk']} / partición {p['Number']}",
            "filesystem": p.get("FileSystem") or "No identificado",
            "mountpoint": f"{p['Drive']}:\\" if p.get("Drive") else "",
            "totalBytes": int(p.get("Size") or 0),
            "usedBytes": max(0, int(p.get("Used") or 0)),
            "os": active_id if f"{p.get('Drive')}:" == system_drive else None,
        }
        for p in info.get("Partitions", [])
    ]
    return {
        "manufacturer": str(info.get("Manufacturer") or "No identificado"),
        "model": str(info.get("Model") or "No identificado"),
        "serial": str(info.get("Serial") or "No identificado"),
        "cpuModel": str(info.get("Cpu") or platform.processor() or "No identificado"),
        "frequencyMHz": float(info.get("Frequency") or 0),
        "firmware": info.get("Firmware", "UNKNOWN"),
        "bootManager": (
            "Windows Boot Manager / UEFI" if firmware_ok else "BCD" if bcd_ok else "No identificado"
        ),
        "bootType": boot_type,
        "bootReason": reason,
        "operatingSystems": installed,
        "disks": disks,
        "partitions": partitions,
    }


def detect_boot(active_id: str) -> dict[str, Any]:
    if platform.system() == "Windows":
        return windows_boot(active_id)
    if platform.system() == "Linux":
        return linux_boot(active_id)
    return {
        "firmware": "UNKNOWN",
        "bootManager": "No soportado",
        "bootType": "UNKNOWN",
        "bootReason": "El alcance inicial cubre Windows y Linux.",
        "operatingSystems": [
            installation(active_id, platform.system(), platform.version(), "", True)
        ],
        "disks": [],
        "partitions": [],
    }
