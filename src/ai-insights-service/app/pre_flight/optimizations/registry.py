"""Optimization strategy registry."""

from __future__ import annotations

from threading import RLock
from typing import Iterable, Iterator, Optional

from .base import OptimizationStrategy


class OptimizationRegistry:
    def __init__(self) -> None:
        self._strategies: dict[str, OptimizationStrategy] = {}
        self._lock = RLock()

    def register(self, strategy: OptimizationStrategy, *, replace: bool = False) -> None:
        name = strategy.metadata.name
        with self._lock:
            if name in self._strategies and not replace:
                raise ValueError(f"Optimization already registered: {name}")
            self._strategies[name] = strategy

    def register_many(self, strategies: Iterable[OptimizationStrategy], *, replace: bool = False) -> None:
        for strategy in strategies:
            self.register(strategy, replace=replace)

    def get(self, name: str) -> OptimizationStrategy:
        with self._lock:
            try:
                return self._strategies[name]
            except KeyError as exc:
                raise KeyError(f"Unknown optimization: {name}") from exc

    def find(self, name: str) -> Optional[OptimizationStrategy]:
        with self._lock:
            return self._strategies.get(name)

    def contains(self, name: str) -> bool:
        return self.find(name) is not None

    def remove(self, name: str) -> None:
        with self._lock:
            self._strategies.pop(name, None)

    def names(self) -> tuple[str, ...]:
        with self._lock:
            return tuple(sorted(self._strategies))

    def values(self) -> tuple[OptimizationStrategy, ...]:
        with self._lock:
            return tuple(self._strategies.values())

    def __iter__(self) -> Iterator[OptimizationStrategy]:
        return iter(self.values())


class _NoOpOptimization(OptimizationStrategy):
    """Safe placeholder useful until concrete strategy modules are registered."""

    def __init__(self, name: str) -> None:
        from .metadata import OptimizationMetadata
        from .base import OptimizationStatus, OptimizationResult

        self.metadata = OptimizationMetadata.create(
            name=name,
            description="Placeholder optimization; no configuration changes are made.",
        )

    def is_applicable(self, context):
        return False

    def apply(self, context):
        from .base import OptimizationStatus, OptimizationResult

        return OptimizationResult(
            optimization_name=self.metadata.name,
            status=OptimizationStatus.SKIPPED,
            message="Placeholder strategy is not executable",
        )


def default_registry() -> OptimizationRegistry:
    """Create a registry with no-op placeholders for core extension points.

    Concrete optimization modules should replace these entries during application startup.
    """
    registry = OptimizationRegistry()
    for name in (
        "batch_size_optimization",
        "gradient_accumulation",
        "mixed_precision_training",
        "cpu_thread_optimization",
        "data_loading_optimization",
        "model_compilation",
        "memory_cleanup",
    ):
        registry.register(_NoOpOptimization(name))
    return registry
