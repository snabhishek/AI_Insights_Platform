"""Base contracts shared by all optimization modules."""

from __future__ import annotations

from abc import ABC, abstractmethod
from copy import deepcopy
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Mapping, MutableMapping, Optional, Sequence

from .metadata import OptimizationMetadata


class OptimizationStatus(str, Enum):
    NOT_ATTEMPTED = "not_attempted"
    APPLIED = "applied"
    SKIPPED = "skipped"
    FAILED = "failed"
    ROLLED_BACK = "rolled_back"
    VALIDATION_FAILED = "validation_failed"


@dataclass(slots=True)
class ResourceSnapshot:
    cpu_logical_cores: int = 1
    cpu_physical_cores: int = 1
    ram_total_bytes: int = 0
    ram_available_bytes: int = 0
    disk_free_bytes: int = 0
    gpu_count: int = 0
    gpu_memory_bytes: int = 0
    capabilities: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        for name in (
            "cpu_logical_cores",
            "cpu_physical_cores",
            "ram_total_bytes",
            "ram_available_bytes",
            "disk_free_bytes",
            "gpu_count",
            "gpu_memory_bytes",
        ):
            if getattr(self, name) < 0:
                raise ValueError(f"{name} cannot be negative")

    @property
    def has_gpu(self) -> bool:
        return self.gpu_count > 0


@dataclass(slots=True)
class OptimizationContext:
    """Runtime information passed to optimization strategies."""

    framework: str
    task_type: str
    config: MutableMapping[str, Any]
    dataset_info: Mapping[str, Any] = field(default_factory=dict)
    model_info: Mapping[str, Any] = field(default_factory=dict)
    resources: ResourceSnapshot = field(default_factory=ResourceSnapshot)
    capabilities: set[str] = field(default_factory=set)
    selected_optimizations: Sequence[str] = field(default_factory=tuple)
    dry_run: bool = False
    metadata: MutableMapping[str, Any] = field(default_factory=dict)

    def clone(self) -> "OptimizationContext":
        return OptimizationContext(
            framework=self.framework,
            task_type=self.task_type,
            config=deepcopy(dict(self.config)),
            dataset_info=deepcopy(dict(self.dataset_info)),
            model_info=deepcopy(dict(self.model_info)),
            resources=deepcopy(self.resources),
            capabilities=set(self.capabilities),
            selected_optimizations=tuple(self.selected_optimizations),
            dry_run=self.dry_run,
            metadata=deepcopy(dict(self.metadata)),
        )


@dataclass(slots=True)
class OptimizationResult:
    optimization_name: str
    status: OptimizationStatus
    changed: bool = False
    message: str = ""
    before_config: Optional[Dict[str, Any]] = None
    after_config: Optional[Dict[str, Any]] = None
    rollback_data: Any = None
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class OptimizationStrategy(ABC):
    """Interface implemented by every optimization strategy."""

    metadata: OptimizationMetadata

    @abstractmethod
    def is_applicable(self, context: OptimizationContext) -> bool:
        """Return whether the optimization can be applied to this context."""

    @abstractmethod
    def apply(self, context: OptimizationContext) -> OptimizationResult:
        """Apply the optimization and return an execution result."""

    def validate(self, context: OptimizationContext) -> list[str]:
        """Return validation errors. Empty list means valid."""
        return []

    def rollback(self, context: OptimizationContext, rollback_data: Any) -> OptimizationResult:
        """Restore state changed by this strategy."""
        if rollback_data is None:
            return OptimizationResult(
                optimization_name=self.metadata.name,
                status=OptimizationStatus.SKIPPED,
                message="No rollback data was provided",
            )
        context.config.clear()
        context.config.update(deepcopy(rollback_data))
        return OptimizationResult(
            optimization_name=self.metadata.name,
            status=OptimizationStatus.ROLLED_BACK,
            changed=True,
            message="Configuration restored from rollback data",
        )
