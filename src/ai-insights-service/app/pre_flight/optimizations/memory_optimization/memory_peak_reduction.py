"""Strategy: memory_peak_reduction."""
from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='memory_peak_reduction',
    description='Reduce peak memory from simultaneous allocations.',
    category='peak_memory',
    priority="high",
    tags=["memory", 'peak_memory'],
    defaults={'enabled': True, 'max_concurrent_allocations': 1},
)

def create_strategy():
    """Return an independent strategy copy."""
    return clone_strategy(STRATEGY)
