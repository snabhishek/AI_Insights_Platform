"""Shared CPU optimization contracts."""

from dataclasses import dataclass, field
from copy import deepcopy
from typing import Any, Callable, Mapping, MutableMapping, Optional


Transform = Callable[[MutableMapping[str, Any], "CPUOptimizationContext"], Mapping[str, Any]]


@dataclass(frozen=True)
class CPUOptimizationSpec:
    name: str
    category: str
    description: str
    priority: int = 50
    risk: str = "low"
    accuracy_risk: str = "low"
    required_capabilities: tuple[str, ...] = ("cpu",)
    dependencies: tuple[str, ...] = ()
    conflicts: tuple[str, ...] = ()
    tags: tuple[str, ...] = ("cpu",)


@dataclass
class CPUOptimizationContext:
    config: MutableMapping[str, Any]
    system: Mapping[str, Any] = field(default_factory=dict)
    dataset: Mapping[str, Any] = field(default_factory=dict)
    model: Mapping[str, Any] = field(default_factory=dict)
    runtime: Mapping[str, Any] = field(default_factory=dict)
    metrics: Mapping[str, Any] = field(default_factory=dict)
    framework: str = "generic"
    dry_run: bool = False


@dataclass
class CPUOptimizationResult:
    optimization: str
    applied: bool
    changed: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)


class CPUOptimizationStrategy:
    def __init__(self, spec: CPUOptimizationSpec, transform: Optional[Transform]):
        self.spec = spec
        self._transform = transform

    def is_applicable(self, context: CPUOptimizationContext) -> bool:
        capabilities = set(context.system.get("capabilities", ("cpu",)))
        return set(self.spec.required_capabilities).issubset(capabilities)

    def apply(self, context: CPUOptimizationContext) -> CPUOptimizationResult:
        if not self.is_applicable(context):
            return CPUOptimizationResult(
                self.spec.name, False,
                warnings=["CPU capability requirements are not satisfied."]
            )
        if self._transform is None:
            return CPUOptimizationResult(
                self.spec.name, False,
                warnings=["No transformation function was configured."]
            )

        before = deepcopy(dict(context.config))
        try:
            proposed = dict(self._transform(context.config, context))
        except (TypeError, ValueError, KeyError, OverflowError) as exc:
            return CPUOptimizationResult(
                self.spec.name, False,
                errors=[f"Transformation failed: {exc}"]
            )

        changed = {
            key: value for key, value in proposed.items()
            if before.get(key) != value
        }
        if not context.dry_run:
            context.config.update(changed)

        return CPUOptimizationResult(
            self.spec.name,
            bool(changed),
            changed=changed,
            details={"dry_run": context.dry_run},
        )


def set_if_absent(key: str, value: Any) -> Transform:
    def transform(config: MutableMapping[str, Any], context: CPUOptimizationContext):
        return {} if key in config else {key: value}
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
    required_capabilities: tuple[str, ...] = ("cpu",),
    dependencies: tuple[str, ...] = (),
    conflicts: tuple[str, ...] = (),
    tags: tuple[str, ...] = ("cpu",),
) -> CPUOptimizationStrategy:
    if not name.strip():
        raise ValueError("Optimization name cannot be empty.")
    if priority < 0:
        raise ValueError("Priority cannot be negative.")

    spec = CPUOptimizationSpec(
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
    return CPUOptimizationStrategy(spec, transform)
