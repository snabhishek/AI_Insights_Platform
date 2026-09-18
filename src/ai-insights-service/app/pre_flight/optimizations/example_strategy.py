"""Small example strategy showing how to extend the framework."""

from __future__ import annotations

from copy import deepcopy

from .base import OptimizationContext, OptimizationResult, OptimizationStatus, OptimizationStrategy
from .metadata import OptimizationMetadata, OptimizationScope


class ExampleBatchSizeOptimization(OptimizationStrategy):
    metadata = OptimizationMetadata.create(
        name="example_batch_size_optimization",
        description="Increase batch size only when an explicit upper bound is available.",
        scope=OptimizationScope.COMMON,
        tags=("training", "batch_size"),
        expected_speedup=0.10,
        expected_memory_reduction=0.0,
    )

    def is_applicable(self, context: OptimizationContext) -> bool:
        return (
            isinstance(context.config.get("batch_size"), int)
            and context.config["batch_size"] > 0
            and isinstance(context.config.get("max_batch_size"), int)
            and context.config["batch_size"] < context.config["max_batch_size"]
        )

    def apply(self, context: OptimizationContext) -> OptimizationResult:
        before = deepcopy(dict(context.config))
        current = int(context.config["batch_size"])
        maximum = int(context.config["max_batch_size"])
        new_value = min(current * 2, maximum)
        changed = new_value != current
        if changed and not context.dry_run:
            context.config["batch_size"] = new_value

        return OptimizationResult(
            optimization_name=self.metadata.name,
            status=OptimizationStatus.APPLIED if changed else OptimizationStatus.SKIPPED,
            changed=changed,
            message=f"Batch size changed from {current} to {new_value}" if changed else "No change required",
            before_config=before,
            after_config=dict(context.config),
            rollback_data=before,
        )
