from ..models import *


class DecisionEngine:

    def decide(self,
               config,
               system,
               capabilities,
               estimator,
               planner,
               safety_margin=.85):
        candidates = [c for c in capabilities if c.supported]
        ranked = sorted(candidates,
                        key=lambda c: {
                            ExecutionKind.GPU: 0,
                            ExecutionKind.MULTI_GPU: 1,
                            ExecutionKind.CPU: 2
                        }.get(c.execution_kind, 9))
        for cap in ranked:
            est = estimator.estimate(config, cap, system)
            if system.disk_free_gb < 1:
                return self._blocked('Insufficient disk space',
                                     system.warnings, est)
            if cap.execution_kind == ExecutionKind.CPU:
                limit = system.ram_available_gb * safety_margin
                if est.required_ram_gb is not None and est.required_ram_gb > limit:
                    bottleneck = Bottleneck.RAM
                    props = planner.plan(config, cap, system, est, bottleneck)
                    if props:
                        return self._optimized(cap, est, props, bottleneck,
                                               system.warnings,
                                               'CPU RAM exceeds safe limit')
                    continue
                return self._ready(cap, est, system.warnings)
            gpu = system.gpus[0] if system.gpus else None
            limit = (gpu.free_vram_gb * safety_margin) if gpu else 0
            if est.required_vram_gb is not None and est.required_vram_gb > limit:
                props = planner.plan(config, cap, system, est, Bottleneck.VRAM)
                if props:
                    return self._optimized(cap, est, props, Bottleneck.VRAM,
                                           system.warnings,
                                           'GPU VRAM exceeds safe limit')
                continue
            return self._ready(cap, est, system.warnings)
        return self._blocked('No feasible CPU/GPU execution path',
                             system.warnings)

    def _ready(self, c, e, w):
        return PreflightDecision(
            DecisionStatus.RUN_DIRECTLY, c.execution_kind, c.backend,
            'cpu' if c.execution_kind == ExecutionKind.CPU else 'cuda',
            Bottleneck.NONE, (), e, (c.reason, ), tuple(w),
            e.confidence == 'low')

    def _optimized(self, c, e, p, b, w, r):
        return PreflightDecision(
            DecisionStatus.RUN_WITH_OPTIMIZATION, c.execution_kind, c.backend,
            'cpu' if c.execution_kind == ExecutionKind.CPU else 'cuda', b,
            tuple(p), e, (r, ), tuple(w), True)

    def _blocked(self, r, w, e=None):
        return PreflightDecision(DecisionStatus.BLOCKED, ExecutionKind.NONE,
                                 None, None, Bottleneck.UNKNOWN, (), e
                                 or ResourceEstimate(), (r, ), tuple(w), False)
