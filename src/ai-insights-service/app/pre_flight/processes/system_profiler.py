import os, platform, shutil
from pathlib import Path
from ..models import SystemSnapshot, GPUInfo


class SystemProfiler:

    def profile(self) -> SystemSnapshot:
        warnings = []
        logical = os.cpu_count() or 1
        physical = logical
        total = available = 0.0
        try:
            import psutil
            logical = psutil.cpu_count(True) or logical
            physical = psutil.cpu_count(False) or logical
            mem = psutil.virtual_memory()
            total = mem.total / 1024**3
            available = mem.available / 1024**3
        except ImportError:
            warnings.append(
                'psutil unavailable; RAM information may be incomplete')
        try:
            disk = shutil.disk_usage(Path.cwd()).free / 1024**3
        except OSError:
            disk = 0.0
            warnings.append('Unable to read free disk space')
        gpus = []
        try:
            import torch
            if torch.cuda.is_available():
                for i in range(torch.cuda.device_count()):
                    p = torch.cuda.get_device_properties(i)
                    free, _ = torch.cuda.mem_get_info(i)
                    gpus.append(
                        GPUInfo(i, p.name, p.total_memory / 1024**3,
                                free / 1024**3))
        except Exception as exc:
            warnings.append(f'GPU probe unavailable: {exc}')
        return SystemSnapshot(platform.system(), platform.machine(), physical,
                              logical, round(total, 2), round(available, 2),
                              round(disk, 2), tuple(gpus), tuple(warnings))
