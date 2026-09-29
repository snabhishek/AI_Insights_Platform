"""Strategy: vram_optimization."""
from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='vram_optimization',
    description='Reduce GPU VRAM usage.',
    category='device_memory',
    priority="high",
    tags=["memory", 'device_memory'],
    defaults={'dynamic_batching': True, 'reserve_vram_gb': 0.5},
)

def create_strategy():
    """Return an independent strategy copy."""
    return clone_strategy(STRATEGY)
