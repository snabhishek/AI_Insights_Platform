from abc import ABC, abstractmethod
from .models import EstimationContext, EstimationResult

class BaseEstimator(ABC):
    name = "base_estimator"
    version = "1.0.0"

    def result(self, **kwargs):
        metadata = {"version": self.version, **kwargs.pop("metadata", {})}
        return EstimationResult(estimator_name=self.name, metadata=metadata, **kwargs)

    @abstractmethod
    def estimate(self, context: EstimationContext) -> EstimationResult:
        raise NotImplementedError
