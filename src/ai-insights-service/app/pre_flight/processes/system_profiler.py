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
            # Fallback for Windows without external psutil dependency
            if platform.system() == 'Windows':
                try:
                    import ctypes
                    import struct
                    stat = (ctypes.c_ulong * 16)()
                    stat[0] = 64
                    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                        t_bytes, a_bytes = struct.unpack_from('QQ', bytearray(stat), 8)
                        total = t_bytes / 1024**3
                        available = a_bytes / 1024**3
                except Exception as ex:
                    warnings.append(f'RAM probe fallback failed: {ex}')
            elif os.path.exists('/proc/meminfo'):
                try:
                    with open('/proc/meminfo') as f:
                        lines = f.readlines()
                    meminfo = {line.split(':')[0]: float(line.split(':')[1].strip().split()[0]) for line in lines if ':' in line}
                    if 'MemTotal' in meminfo:
                        total = meminfo['MemTotal'] / (1024**2)
                    if 'MemAvailable' in meminfo:
                        available = meminfo['MemAvailable'] / (1024**2)
                except Exception as ex:
                    warnings.append(f'Linux meminfo probe failed: {ex}')
            if total == 0.0:
                warnings.append('psutil unavailable; RAM information may be incomplete')

        try:
            disk = shutil.disk_usage(Path.cwd()).free / 1024**3
        except OSError:
            disk = 0.0
            warnings.append('Unable to read free disk space')
        gpus = []
        torch_cuda_ready = False
        try:
            import torch
            if torch.cuda.is_available():
                torch_cuda_ready = True
                for i in range(torch.cuda.device_count()):
                    p = torch.cuda.get_device_properties(i)
                    free, _ = torch.cuda.mem_get_info(i)
                    gpus.append(
                        GPUInfo(i, p.name, round(p.total_memory / 1024**3, 2),
                                round(free / 1024**3, 2)))
        except Exception as exc:
            pass

        if not gpus:
            # Fallback to nvidia-smi for host GPU detection
            try:
                import subprocess
                res = subprocess.run(
                    ['nvidia-smi', '--query-gpu=index,name,memory.total,memory.free',
                     '--format=csv,noheader,nounits'],
                    capture_output=True, text=True, timeout=4, check=False)
                if res.returncode == 0 and res.stdout.strip():
                    for line in res.stdout.strip().splitlines():
                        parts = [p.strip() for p in line.split(',') if p.strip()]
                        if len(parts) >= 4:
                            idx = int(parts[0])
                            name = parts[1]
                            tot = round(float(parts[2]) / 1024, 2)
                            free = round(float(parts[3]) / 1024, 2)
                            gpus.append(GPUInfo(idx, name, tot, free))
                    if gpus and not torch_cuda_ready:
                        warnings.append('GPU hardware detected via nvidia-smi, but PyTorch CUDA runtime is not available in Python environment')
            except Exception as exc:
                warnings.append(f'GPU probe unavailable: {exc}')
        elif not torch_cuda_ready:
            warnings.append('PyTorch CUDA runtime not available')
        return SystemSnapshot(platform.system(), platform.machine(), physical,
                              logical, round(total, 2), round(available, 2),
                              round(disk, 2), tuple(gpus), tuple(warnings))
