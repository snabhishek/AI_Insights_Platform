"""Compatibility checks for optimization strategies."""

from __future__ import annotations

from dataclasses import dataclass, field

from .base import OptimizationContext, OptimizationStrategy


@dataclass(slots=True)
class CompatibilityResult:
    compatible: bool
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class CompatibilityChecker:
    def check(self, strategy: OptimizationStrategy, context: OptimizationContext) -> CompatibilityResult:
        metadata = strategy.metadata
        reasons: list[str] = []
        warnings: list[str] = []

        if metadata.supported_frameworks:
            framework = context.framework.lower()
            supported = {item.lower() for item in metadata.supported_frameworks}
            if framework not in supported:
                reasons.append(
                    f"Framework '{context.framework}' is not supported; expected one of {sorted(supported)}"
                )

        missing = metadata.required_capabilities - context.capabilities
        if missing:
            reasons.append(f"Missing required capabilities: {sorted(missing)}")

        blocked = metadata.incompatible_capabilities & context.capabilities
        if blocked:
            reasons.append(f"Incompatible capabilities detected: {sorted(blocked)}")

        if metadata.accuracy_risk > 0.25:
            warnings.append(
                f"Optimization has estimated accuracy risk of {metadata.accuracy_risk:.0%}"
            )

        if not strategy.is_applicable(context):
            reasons.append("Strategy-specific applicability check returned false")

        return CompatibilityResult(
            compatible=not reasons,
            reasons=reasons,
            warnings=warnings,
        )
