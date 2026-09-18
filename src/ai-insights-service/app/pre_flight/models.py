from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Mapping


class ExecutionKind(str, Enum):
    CPU = 'cpu'
    GPU = 'gpu'
    MULTI_GPU = 'multi_gpu'
    REMOTE = 'remote'
    NONE = 'none'


class DecisionStatus(str, Enum):
    RUN_DIRECTLY = 'run_directly'
    RUN_WITH_OPTIMIZATION = 'run_with_optimization'
    BLOCKED = 'blocked'
    MANUAL_REVIEW_REQUIRED = 'manual_review_required'


class Bottleneck(str, Enum):
    NONE = 'none'
    CPU = 'cpu'
    RAM = 'ram'
    GPU = 'gpu'
    VRAM = 'vram'
    DISK = 'disk'
    DATA_IO = 'data_io'
    UNKNOWN = 'unknown'


@dataclass(frozen=True)
class GPUInfo:
    index: int
    name: str
    total_vram_gb: float
    free_vram_gb: float


@dataclass(frozen=True)
class SystemSnapshot:
    os_name: str
    architecture: str
    cpu_physical: int
    cpu_logical: int
    ram_total_gb: float
    ram_available_gb: float
    disk_free_gb: float
    gpus: tuple[GPUInfo, ...] = ()
    warnings: tuple[str, ...] = ()

    @property
    def has_gpu(self):
        return bool(self.gpus)


@dataclass(frozen=True)
class Capability:
    execution_kind: ExecutionKind
    backend: str
    supported: bool
    reason: str
    optimizations: tuple[str, ...] = ()


@dataclass(frozen=True)
class ResourceEstimate:
    required_ram_gb: float | None = None
    required_vram_gb: float | None = None
    required_disk_gb: float | None = None
    confidence: str = 'low'
    source: str = 'unknown'
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class OptimizationProposal:
    name: str
    category: str
    supported: bool
    reason: str
    parameters: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class PreflightDecision:
    status: DecisionStatus
    execution_kind: ExecutionKind
    backend: str | None
    device: str | None
    bottleneck: Bottleneck
    optimizations: tuple[OptimizationProposal, ...]
    estimate: ResourceEstimate
    reasons: tuple[str, ...]
    warnings: tuple[str, ...]
    requires_validation: bool

    def as_dict(self):
        return asdict(self)
