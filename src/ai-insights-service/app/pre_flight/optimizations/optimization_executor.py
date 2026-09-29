"""Execute optimization plans safely."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .base import OptimizationContext, OptimizationResult, OptimizationStatus
from .optimization_planner import OptimizationPlan
from .registry import OptimizationRegistry


@dataclass(slots=True)
class ExecutionReport:
    results: list[OptimizationResult] = field(default_factory=list)
    final_context: Optional[OptimizationContext] = None
    stopped_on_error: bool = False

    @property
    def successful(self) -> bool:
        return not self.stopped_on_error and all(
            result.status in {OptimizationStatus.APPLIED, OptimizationStatus.SKIPPED}
            for result in self.results
        )


class OptimizationExecutor:
    def __init__(self, registry: OptimizationRegistry) -> None:
        self.registry = registry

    def execute(
        self,
        plan: OptimizationPlan,
        context: OptimizationContext,
        *,
        stop_on_error: bool = True,
    ) -> ExecutionReport:
        working_context = context.clone()
        working_context.selected_optimizations = plan.names
        results: list[OptimizationResult] = []

        if plan.errors:
            return ExecutionReport(
                results=[
                    OptimizationResult(
                        optimization_name="plan",
                        status=OptimizationStatus.FAILED,
                        message="Plan contains errors",
                        errors=list(plan.errors),
                    )
                ],
                final_context=working_context,
                stopped_on_error=True,
            )

        for item in plan.items:
            strategy = self.registry.get(item.name)
            before = dict(working_context.config)
            try:
                if not strategy.is_applicable(working_context):
                    result = OptimizationResult(
                        optimization_name=item.name,
                        status=OptimizationStatus.SKIPPED,
                        message="Optimization is no longer applicable at execution time",
                    )
                else:
                    result = strategy.apply(working_context)
                    result.before_config = before
                    result.after_config = dict(working_context.config)
                    if result.rollback_data is None:
                        result.rollback_data = before
            except Exception as exc:  # defensive boundary around third-party strategies
                working_context.config.clear()
                working_context.config.update(before)
                result = OptimizationResult(
                    optimization_name=item.name,
                    status=OptimizationStatus.FAILED,
                    message="Optimization raised an exception",
                    before_config=before,
                    after_config=dict(working_context.config),
                    errors=[f"{type(exc).__name__}: {exc}"],
                )

            results.append(result)
            if result.status == OptimizationStatus.FAILED and stop_on_error:
                return ExecutionReport(results, working_context, True)

        return ExecutionReport(results, working_context, False)
