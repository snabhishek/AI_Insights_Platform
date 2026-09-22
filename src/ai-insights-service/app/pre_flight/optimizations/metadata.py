"""Metadata contracts for optimization strategies."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import FrozenSet, Iterable, Mapping, Optional


class OptimizationRisk(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class OptimizationScope(str, Enum):
    COMMON = "common"
    CPU = "cpu"
    GPU = "gpu"
    DISTRIBUTED = "distributed"
    MODEL = "model"
    FRAMEWORK = "framework"
    DATA = "data"
    MEMORY = "memory"
    SEARCH = "search"
    RELIABILITY = "reliability"


@dataclass(frozen=True, slots=True)
class OptimizationMetadata:
    """Describes when and how an optimization may be used."""

    name: str
    display_name: str
    description: str = ""
    scope: OptimizationScope = OptimizationScope.COMMON
    risk: OptimizationRisk = OptimizationRisk.LOW
    priority: int = 100
    supported_frameworks: FrozenSet[str] = frozenset()
    required_capabilities: FrozenSet[str] = frozenset()
    incompatible_capabilities: FrozenSet[str] = frozenset()
    conflicts_with: FrozenSet[str] = frozenset()
    requires: FrozenSet[str] = frozenset()
    tags: FrozenSet[str] = frozenset()
    accuracy_risk: float = 0.0
    expected_speedup: float = 0.0
    expected_memory_reduction: float = 0.0
    expected_cpu_reduction: float = 0.0
    expected_gpu_reduction: float = 0.0
    reversible: bool = True
    enabled_by_default: bool = True
    parameters: Mapping[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.name or self.name.strip() != self.name:
            raise ValueError("Optimization name must be non-empty and trimmed")
        if self.priority < 0:
            raise ValueError("Optimization priority cannot be negative")
        for field_name in (
            "accuracy_risk",
            "expected_speedup",
            "expected_memory_reduction",
            "expected_cpu_reduction",
            "expected_gpu_reduction",
        ):
            value = getattr(self, field_name)
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"{field_name} must be between 0 and 1")

    @classmethod
    def create(
        cls,
        name: str,
        display_name: Optional[str] = None,
        *,
        scope: OptimizationScope = OptimizationScope.COMMON,
        risk: OptimizationRisk = OptimizationRisk.LOW,
        priority: int = 100,
        supported_frameworks: Iterable[str] = (),
        required_capabilities: Iterable[str] = (),
        incompatible_capabilities: Iterable[str] = (),
        conflicts_with: Iterable[str] = (),
        requires: Iterable[str] = (),
        tags: Iterable[str] = (),
        **kwargs: object,
    ) -> "OptimizationMetadata":
        return cls(
            name=name,
            display_name=display_name or name.replace("_", " ").title(),
            scope=scope,
            risk=risk,
            priority=priority,
            supported_frameworks=frozenset(supported_frameworks),
            required_capabilities=frozenset(required_capabilities),
            incompatible_capabilities=frozenset(incompatible_capabilities),
            conflicts_with=frozenset(conflicts_with),
            requires=frozenset(requires),
            tags=frozenset(tags),
            **kwargs,
        )
