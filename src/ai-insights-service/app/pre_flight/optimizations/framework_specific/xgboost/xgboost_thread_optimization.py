"""Framework-specific strategy: xgboost_thread_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='xgboost_thread_optimization',
    framework='xgboost',
    description='Optimize XGBoost thread usage.',
    category='parallelism',
    defaults={'nthread': 0, 'max_bin': 256},
    tags=["xgboost", "parallelism", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
