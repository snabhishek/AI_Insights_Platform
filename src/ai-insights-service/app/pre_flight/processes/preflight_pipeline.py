from .system_profiler import SystemProfiler
from .capability_resolver import CapabilityResolver
from .resource_estimator import ResourceEstimator
from .optimization_planner import OptimizationPlanner
from .decision_engine import DecisionEngine


class PreflightPipeline:

    def run(self, config):
        system = SystemProfiler().profile()
        capabilities = CapabilityResolver().resolve(config, system)
        decision = DecisionEngine().decide(config, system, capabilities,
                                           ResourceEstimator(),
                                           OptimizationPlanner())
        return {
            'system': system,
            'capabilities': capabilities,
            'decision': decision
        }
