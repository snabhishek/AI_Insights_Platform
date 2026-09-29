"""Select applicable optimizations from a registry."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional

from .base import OptimizationContext
from .compatibility import CompatibilityChecker
from .conflict_resolver import ConflictResolver
from .registry import OptimizationRegistry


@dataclass(slots=True)
class SelectionResult:
    selected: list[str] = field(default_factory=list)
    rejected: dict[str, list[str]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class OptimizationSelector:
    def __init__(
        self,
        registry: OptimizationRegistry,
        compatibility_checker: Optional[CompatibilityChecker] = None,
        conflict_resolver: Optional[ConflictResolver] = None,
    ) -> None:
        self.registry = registry
        self.compatibility_checker = compatibility_checker or CompatibilityChecker()
        self.conflict_resolver = conflict_resolver or ConflictResolver(registry)

    def select(
        self,
        context: OptimizationContext,
        candidates: Optional[Iterable[str]] = None,
    ) -> SelectionResult:
        names = list(candidates) if candidates is not None else list(self.registry.names())
        compatible: list[str] = []
        rejected: dict[str, list[str]] = {}
        warnings: list[str] = []

        for name in names:
            strategy = self.registry.find(name)
            if strategy is None:
                rejected[name] = ["Optimization is not registered"]
                continue
            result = self.compatibility_checker.check(strategy, context)
            warnings.extend(f"{name}: {warning}" for warning in result.warnings)
            if result.compatible:
                compatible.append(name)
            else:
                rejected[name] = result.reasons

        resolution = self.conflict_resolver.resolve(compatible)
        return SelectionResult(
            selected=resolution.selected,
            rejected=rejected,
            warnings=warnings + resolution.warnings,
            errors=resolution.errors,
        )
