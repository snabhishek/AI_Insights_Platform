"""Framework-specific strategy: xgboost_histogram_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='xgboost_histogram_optimization',
    framework='xgboost',
    description='Optimize XGBoost histogram algorithms.',
    category='histogram',
    defaults={'tree_method': 'hist', 'max_bin': 256, 'max_cached_hist_node': 65536},
    tags=["xgboost", "histogram", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
