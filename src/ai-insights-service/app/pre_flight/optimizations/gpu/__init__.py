"""GPU optimization package."""

from .gpu.registry import load_gpu_strategies

__all__ = ["load_gpu_strategies"]
