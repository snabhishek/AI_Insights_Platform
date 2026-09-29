"""Framework-specific strategy: xgboost_cpu_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='xgboost_cpu_optimization',
    framework='xgboost',
    description='Configure XGBoost CPU execution.',
    category='cpu',
    defaults={'tree_method': 'hist', 'sampling_method': 'uniform'},
    tags=["xgboost", "cpu", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
