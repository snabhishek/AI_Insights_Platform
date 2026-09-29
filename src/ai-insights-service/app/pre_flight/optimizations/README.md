# Optimization Core

Dependency-free core framework for an AutoML optimization engine.

## Basic usage

```python
from optimizations_core import (
    OptimizationContext,
    OptimizationPlanner,
    OptimizationExecutor,
    OptimizationValidator,
    ResourceSnapshot,
    default_registry,
)
from optimizations_core.example_strategy import ExampleBatchSizeOptimization

registry = default_registry()
registry.register(ExampleBatchSizeOptimization())

context = OptimizationContext(
    framework="pytorch",
    task_type="classification",
    config={"batch_size": 16, "max_batch_size": 64},
    resources=ResourceSnapshot(cpu_logical_cores=8, cpu_physical_cores=4),
)

planner = OptimizationPlanner(registry)
plan = planner.plan(context, ["example_batch_size_optimization"])

executor = OptimizationExecutor(registry)
execution = executor.execute(plan, context)

validator = OptimizationValidator(registry)
validation = validator.validate(execution.final_context, execution)

print(plan.names)
print(execution.final_context.config)
print(validation.valid)
```
