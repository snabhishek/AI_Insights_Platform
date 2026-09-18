"""Conflict and dependency resolution for optimization selections."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from .base import OptimizationStrategy
from .registry import OptimizationRegistry


@dataclass(slots=True)
class ConflictResolution:
    selected: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class ConflictResolver:
    def __init__(self, registry: OptimizationRegistry) -> None:
        self.registry = registry

    def resolve(self, names: Iterable[str]) -> ConflictResolution:
        requested = list(dict.fromkeys(names))
        selected: list[str] = []
        removed: list[str] = []
        warnings: list[str] = []
        errors: list[str] = []

        def add(name: str, stack: tuple[str, ...] = ()) -> None:
            if name in selected:
                return
            if name in stack:
                errors.append(f"Circular optimization dependency: {' -> '.join(stack + (name,))}")
                return

            strategy = self.registry.find(name)
            if strategy is None:
                errors.append(f"Unknown optimization requested: {name}")
                return

            for dependency in strategy.metadata.requires:
                add(dependency, stack + (name,))

            for existing_name in list(selected):
                existing = self.registry.get(existing_name)
                if name in existing.metadata.conflicts_with or existing_name in strategy.metadata.conflicts_with:
                    if strategy.metadata.priority < existing.metadata.priority:
                        selected.remove(existing_name)
                        removed.append(existing_name)
                        warnings.append(
                            f"Removed '{existing_name}' because '{name}' has higher priority"
                        )
                    else:
                        removed.append(name)
                        warnings.append(
                            f"Skipped '{name}' because it conflicts with '{existing_name}'"
                        )
                        return

            selected.append(name)

        for name in requested:
            add(name)

        selected.sort(key=lambda item: (self.registry.get(item).metadata.priority, item))
        return ConflictResolution(selected, removed, warnings, errors)
