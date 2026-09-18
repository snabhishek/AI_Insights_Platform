from ..models import ResourceEstimate


class ResourceEstimator:

    def estimate(self, config, capability, system, applied=()):
        external = config.get('resource_estimate') or {}
        return ResourceEstimate(external.get('required_ram_gb'),
                                external.get('required_vram_gb'),
                                external.get('required_disk_gb'),
                                external.get('confidence', 'low'),
                                external.get('source', 'config_or_unknown'),
                                tuple(external.get('warnings', ())))
