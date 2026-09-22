"""Create deterministic optimization execution plans."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional

from .base import OptimizationContext
from .optimization_selector import OptimizationSelector
from .registry import OptimizationRegistry


@dataclass(slots=True)
class PlannedOptimization:
    name: str
    order: int
    reason: str = ""


@dataclass(slots=True)
class OptimizationPlan:
    items: list[PlannedOptimization] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(item.name for item in self.items)


class OptimizationPlanner:
    def __init__(self, registry: OptimizationRegistry, selector: Optional[OptimizationSelector] = None) -> None:
        self.registry = registry
        self.selector = selector or OptimizationSelector(registry)

    def plan(
        self,
        context: OptimizationContext,
        candidates: Optional[Iterable[str]] = None,
    ) -> OptimizationPlan:
        selection = self.selector.select(context, candidates)
        items = [
            PlannedOptimization(
                name=name,
                order=index,
                reason="Selected as compatible and conflict-free",
            )
            for index, name in enumerate(selection.selected, start=1)
        ]
        return OptimizationPlan(
            items=items,
            warnings=selection.warnings,
            errors=selection.errors,
        )
