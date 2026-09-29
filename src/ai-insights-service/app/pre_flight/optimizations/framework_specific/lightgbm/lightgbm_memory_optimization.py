"""Framework-specific strategy: lightgbm_memory_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='lightgbm_memory_optimization',
    framework='lightgbm',
    description='Reduce LightGBM dataset memory usage.',
    category='memory',
    defaults={'max_bin': 255, 'enable_bundle': True, 'use_missing': True},
    tags=["lightgbm", "memory", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
