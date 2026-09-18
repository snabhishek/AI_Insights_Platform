"""Validation of optimization results and final configuration."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from .base import OptimizationContext, OptimizationStatus
from .optimization_executor import ExecutionReport
from .registry import OptimizationRegistry


@dataclass(slots=True)
class ValidationReport:
    valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    checked_optimizations: list[str] = field(default_factory=list)


class OptimizationValidator:
    def __init__(self, registry: OptimizationRegistry) -> None:
        self.registry = registry

    def validate(
        self,
        context: OptimizationContext,
        execution_report: ExecutionReport,
        *,
        required_config_keys: Iterable[str] = (),
    ) -> ValidationReport:
        errors: list[str] = []
        warnings: list[str] = []
        checked: list[str] = []

        if execution_report.stopped_on_error:
            errors.append("Execution stopped because an optimization failed")

        for result in execution_report.results:
            if result.status == OptimizationStatus.FAILED:
                errors.extend(f"{result.optimization_name}: {error}" for error in result.errors)
                if not result.errors:
                    errors.append(f"{result.optimization_name}: execution failed")
                continue

            if result.status not in {OptimizationStatus.APPLIED, OptimizationStatus.SKIPPED}:
                warnings.append(
                    f"{result.optimization_name}: status was {result.status.value}"
                )

            strategy = self.registry.find(result.optimization_name)
            if strategy is None:
                errors.append(f"Missing strategy during validation: {result.optimization_name}")
                continue

            checked.append(result.optimization_name)
            errors.extend(
                f"{result.optimization_name}: {error}"
                for error in strategy.validate(context)
            )

        for key in required_config_keys:
            if key not in context.config:
                errors.append(f"Required configuration key is missing: {key}")

        return ValidationReport(
            valid=not errors,
            errors=errors,
            warnings=warnings,
            checked_optimizations=checked,
        )
