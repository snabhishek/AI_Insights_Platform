"""Rollback support for optimization execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from .base import OptimizationContext, OptimizationResult, OptimizationStatus
from .optimization_executor import ExecutionReport
from .registry import OptimizationRegistry


@dataclass(slots=True)
class RollbackReport:
    successful: bool
    results: list[OptimizationResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class RollbackManager:
    def __init__(self, registry: OptimizationRegistry) -> None:
        self.registry = registry

    def rollback(
        self,
        context: OptimizationContext,
        execution_report: ExecutionReport,
        *,
        optimization_names: Iterable[str] | None = None,
    ) -> RollbackReport:
        requested = set(optimization_names) if optimization_names is not None else None
        results: list[OptimizationResult] = []
        errors: list[str] = []

        for result in reversed(execution_report.results):
            if result.optimization_name == "plan":
                continue
            if requested is not None and result.optimization_name not in requested:
                continue
            if result.status != OptimizationStatus.APPLIED:
                continue

            strategy = self.registry.find(result.optimization_name)
            if strategy is None:
                errors.append(f"Unknown optimization during rollback: {result.optimization_name}")
                continue
            if not strategy.metadata.reversible:
                errors.append(f"Optimization is not reversible: {result.optimization_name}")
                continue

            try:
                rollback_result = strategy.rollback(context, result.rollback_data)
            except Exception as exc:
                rollback_result = OptimizationResult(
                    optimization_name=result.optimization_name,
                    status=OptimizationStatus.FAILED,
                    message="Rollback raised an exception",
                    errors=[f"{type(exc).__name__}: {exc}"],
                )

            results.append(rollback_result)
            if rollback_result.status == OptimizationStatus.FAILED:
                errors.extend(rollback_result.errors)

        return RollbackReport(
            successful=not errors and all(
                item.status in {OptimizationStatus.ROLLED_BACK, OptimizationStatus.SKIPPED}
                for item in results
            ),
            results=results,
            errors=errors,
        )
