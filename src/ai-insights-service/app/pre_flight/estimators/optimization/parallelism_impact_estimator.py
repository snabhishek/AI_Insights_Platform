from ..base import BaseEstimator
from ..models import EstimationContext, EstimationResult
from .._shared import supplied_value

class ParallelismImpactEstimator(BaseEstimator):
    name = 'parallelism_impact_estimator'
    version = "1.0.0"

    def estimate(self, context: EstimationContext) -> EstimationResult:
        value = supplied_value(context, self.name)
        unit = context.metadata.get(self.name + "_unit", "unknown")
        if value is None:
            return self.result(
                status="insufficient_data",
                warnings=["No validated measurement or supported formula was supplied."],
                assumptions=["The estimator never fabricates numeric estimates."]
            )
        return self.result(
            status="estimated",
            estimate=value,
            unit=unit,
            confidence=0.9,
            assumptions=["Estimate was supplied by the caller or a measured baseline."]
        )

def create_estimator():
    return ParallelismImpactEstimator()
