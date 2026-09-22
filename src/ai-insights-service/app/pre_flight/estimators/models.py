from dataclasses import dataclass, field
from typing import Any, Mapping

@dataclass
class EstimationContext:
    config: dict[str, Any] = field(default_factory=dict)
    system: dict[str, Any] = field(default_factory=dict)
    dataset: dict[str, Any] = field(default_factory=dict)
    model: dict[str, Any] = field(default_factory=dict)
    optimization: dict[str, Any] = field(default_factory=dict)
    baseline: dict[str, Any] = field(default_factory=dict)
    framework: str = "unknown"
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]):
        return cls(**{key: dict(value.get(key, {})) for key in ("config","system","dataset","model","optimization","baseline","metadata")}, framework=str(value.get("framework","unknown")))

@dataclass
class EstimationResult:
    estimator_name: str
    status: str = "estimated"
    estimate: float | None = None
    unit: str | None = None
    lower_bound: float | None = None
    upper_bound: float | None = None
    confidence: float | None = None
    assumptions: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self):
        return self.__dict__.copy()
