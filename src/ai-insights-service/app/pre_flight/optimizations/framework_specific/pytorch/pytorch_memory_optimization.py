"""Framework-specific strategy: pytorch_memory_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='pytorch_memory_optimization',
    framework='pytorch',
    description='Reduce PyTorch memory usage and fragmentation.',
    category='memory',
    defaults={'empty_cache_between_trials': True, 'expandable_segments': False},
    tags=["pytorch", "memory", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
