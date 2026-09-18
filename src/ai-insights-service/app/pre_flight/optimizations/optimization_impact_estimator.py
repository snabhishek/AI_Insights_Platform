"""Heuristic impact estimation for optimization strategies."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .base import OptimizationContext
from .registry import OptimizationRegistry


@dataclass(slots=True)
class ImpactEstimate:
    expected_speedup: float
    expected_memory_reduction: float
    expected_cpu_reduction: float
    expected_gpu_reduction: float
    accuracy_risk: float
    confidence: float
    assumptions: list[str]

    def as_dict(self) -> dict[str, object]:
        return {
            "expected_speedup": self.expected_speedup,
            "expected_memory_reduction": self.expected_memory_reduction,
            "expected_cpu_reduction": self.expected_cpu_reduction,
            "expected_gpu_reduction": self.expected_gpu_reduction,
            "accuracy_risk": self.accuracy_risk,
            "confidence": self.confidence,
            "assumptions": list(self.assumptions),
        }


class OptimizationImpactEstimator:
    def __init__(self, registry: OptimizationRegistry) -> None:
        self.registry = registry

    def estimate(self, context: OptimizationContext, names: Iterable[str]) -> ImpactEstimate:
        strategies = [self.registry.get(name) for name in dict.fromkeys(names)]
        if not strategies:
            return ImpactEstimate(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, ["No optimizations selected"])

        speedup = 1.0
        memory = 1.0
        cpu = 1.0
        gpu = 1.0
        accuracy_risk = 0.0
        assumptions: list[str] = []

        for strategy in strategies:
            metadata = strategy.metadata
            speedup *= 1.0 - metadata.expected_speedup
            memory *= 1.0 - metadata.expected_memory_reduction
            cpu *= 1.0 - metadata.expected_cpu_reduction
            gpu *= 1.0 - metadata.expected_gpu_reduction
            accuracy_risk = 1.0 - ((1.0 - accuracy_risk) * (1.0 - metadata.accuracy_risk))
            assumptions.append(
                f"{metadata.name}: metadata-based estimate; actual impact depends on workload"
            )

        confidence = max(0.0, min(1.0, 0.5 + 0.05 * len(strategies)))
        return ImpactEstimate(
            expected_speedup=max(0.0, 1.0 - speedup),
            expected_memory_reduction=max(0.0, 1.0 - memory),
            expected_cpu_reduction=max(0.0, 1.0 - cpu),
            expected_gpu_reduction=max(0.0, 1.0 - gpu),
            accuracy_risk=max(0.0, min(1.0, accuracy_risk)),
            confidence=confidence,
            assumptions=assumptions,
        )
