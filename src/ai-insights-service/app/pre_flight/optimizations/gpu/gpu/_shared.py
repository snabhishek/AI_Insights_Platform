"""Shared contracts and safe helpers for GPU optimization strategies."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, MutableMapping, Optional


Transform = Callable[
    [MutableMapping[str, Any], "GPUOptimizationContext"],
    Mapping[str, Any],
]


@dataclass(frozen=True)
class GPUOptimizationSpec:
    """Metadata for one GPU optimization."""

    name: str
    category: str
    description: str
    priority: int = 50
    risk: str = "low"
    accuracy_risk: str = "low"
    required_capabilities: tuple[str, ...] = ("gpu",)
    dependencies: tuple[str, ...] = ()
    conflicts: tuple[str, ...] = ()
    tags: tuple[str, ...] = ("gpu",)


@dataclass
class GPUOptimizationContext:
    """Runtime context passed to GPU optimization strategies."""

    config: MutableMapping[str, Any]
    system: Mapping[str, Any] = field(default_factory=dict)
    dataset: Mapping[str, Any] = field(default_factory=dict)
    model: Mapping[str, Any] = field(default_factory=dict)
    runtime: Mapping[str, Any] = field(default_factory=dict)
    metrics: Mapping[str, Any] = field(default_factory=dict)
    framework: str = "generic"
    dry_run: bool = False


@dataclass
class GPUOptimizationResult:
    """Result of applying one GPU optimization."""

    optimization: str
    applied: bool
    changed: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


class GPUOptimizationStrategy:
    """Configuration-level GPU optimization strategy."""

    def __init__(
        self,
        spec: GPUOptimizationSpec,
        transform: Optional[Transform],
    ) -> None:
        self.spec = spec
        self._transform = transform

    def is_applicable(self, context: GPUOptimizationContext) -> bool:
        capabilities = set(context.system.get("capabilities", ("gpu",)))
        return set(self.spec.required_capabilities).issubset(capabilities)

    def apply(self, context: GPUOptimizationContext) -> GPUOptimizationResult:
        if not self.is_applicable(context):
            return GPUOptimizationResult(
                self.spec.name,
                False,
                warnings=["GPU capability requirements are not satisfied."],
            )

        if self._transform is None:
            return GPUOptimizationResult(
                self.spec.name,
                False,
                warnings=["No transformation function was configured."],
            )

        before = deepcopy(dict(context.config))

        try:
            proposed = dict(self._transform(context.config, context))
        except (TypeError, ValueError, KeyError, OverflowError) as exc:
            return GPUOptimizationResult(
                self.spec.name,
                False,
                errors=[f"Transformation failed: {exc}"],
            )

        changed = {
            key: value
            for key, value in proposed.items()
            if before.get(key) != value
        }

        if not context.dry_run:
            context.config.update(changed)

        return GPUOptimizationResult(
            self.spec.name,
            bool(changed),
            changed=changed,
            details={"dry_run": context.dry_run},
        )


def set_if_absent(key: str, value: Any) -> Transform:
    """Set a configuration value only if it is absent."""

    def transform(
        config: MutableMapping[str, Any],
        context: GPUOptimizationContext,
    ) -> Mapping[str, Any]:
        if key in config:
            return {}
        return {key: value}

    return transform


def create_strategy(
    *,
    name: str,
    category: str,
    description: str,
    transform: Optional[Transform],
    priority: int = 50,
    risk: str = "low",
    accuracy_risk: str = "low",
    required_capabilities: tuple[str, ...] = ("gpu",),
    dependencies: tuple[str, ...] = (),
    conflicts: tuple[str, ...] = (),
    tags: tuple[str, ...] = ("gpu",),
) -> GPUOptimizationStrategy:
    """Create a GPU optimization strategy."""

    if not name.strip():
        raise ValueError("Optimization name cannot be empty.")
    if priority < 0:
        raise ValueError("Priority cannot be negative.")

    spec = GPUOptimizationSpec(
        name=name,
        category=category,
        description=description,
        priority=priority,
        risk=risk,
        accuracy_risk=accuracy_risk,
        required_capabilities=required_capabilities,
        dependencies=dependencies,
        conflicts=conflicts,
        tags=tags,
    )
    return GPUOptimizationStrategy(spec, transform)
