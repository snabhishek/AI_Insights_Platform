"""Framework-specific strategy: sklearn_memory_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='sklearn_memory_optimization',
    framework='sklearn',
    description='Reduce scikit-learn memory usage.',
    category='memory',
    defaults={'copy_x': False, 'working_memory_mb': 1024},
    tags=["sklearn", "memory", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
