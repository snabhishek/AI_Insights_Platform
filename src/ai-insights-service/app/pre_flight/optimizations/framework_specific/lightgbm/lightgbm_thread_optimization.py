"""Framework-specific strategy: lightgbm_thread_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='lightgbm_thread_optimization',
    framework='lightgbm',
    description='Optimize LightGBM CPU thread usage.',
    category='parallelism',
    defaults={'num_threads': -1, 'force_col_wise': False, 'force_row_wise': False},
    tags=["lightgbm", "parallelism", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
