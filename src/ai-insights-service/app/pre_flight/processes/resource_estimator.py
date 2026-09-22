from ..models import ResourceEstimate


class ResourceEstimator:

    def estimate(self, config, capability, system, applied=()):
        raw_cfg = config.get('configuration') if isinstance(config.get('configuration'), dict) else config
        external = raw_cfg.get('resource_estimate') or config.get('resource_estimate') or {}

        model_sel = raw_cfg.get('model_selection') or config.get('model_selection') or {}
        candidates = (
            raw_cfg.get('models') or
            raw_cfg.get('candidate_models') or
            model_sel.get('models') or
            model_sel.get('candidates') or
            config.get('models') or
            config.get('candidate_models') or
            []
        )
        model_count = max(1, len(candidates) if isinstance(candidates, list) else 1)

        req_ram = external.get('required_ram_gb')
        if req_ram is None:
            # Baseline estimate based on model count
            req_ram = round(min(system.ram_total_gb * 0.75, max(1.5, 1.0 + model_count * 0.5)), 2)

        req_vram = external.get('required_vram_gb')
        if req_vram is None and system.has_gpu:
            gpu = system.gpus[0]
            req_vram = round(min(gpu.total_vram_gb * 0.8, max(1.0, 0.8 + model_count * 0.4)), 2)

        req_disk = external.get('required_disk_gb')
        if req_disk is None:
            req_disk = round(max(0.5, 0.2 * model_count), 2)

        confidence = external.get('confidence', 'calculated' if not external else 'provided')
        source = external.get('source', 'model_topology' if candidates else 'heuristic')

        return ResourceEstimate(req_ram,
                                req_vram,
                                req_disk,
                                confidence,
                                source,
                                tuple(external.get('warnings', ())))

