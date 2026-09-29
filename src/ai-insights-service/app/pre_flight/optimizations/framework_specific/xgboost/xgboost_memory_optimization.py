"""Framework-specific strategy: xgboost_memory_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='xgboost_memory_optimization',
    framework='xgboost',
    description='Reduce XGBoost training memory usage.',
    category='memory',
    defaults={'max_bin': 256, 'external_memory': False, 'max_cached_hist_node': 65536},
    tags=["xgboost", "memory", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
