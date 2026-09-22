"""Strategy: ram_optimization."""
from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='ram_optimization',
    description='Reduce host RAM usage.',
    category='host_memory',
    priority="high",
    tags=["memory", 'host_memory'],
    defaults={'streaming': True, 'max_worker_memory_gb': 4.0},
)

def create_strategy():
    """Return an independent strategy copy."""
    return clone_strategy(STRATEGY)
