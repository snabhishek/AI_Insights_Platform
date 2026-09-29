"""Framework-specific strategy: xgboost_gpu_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='xgboost_gpu_optimization',
    framework='xgboost',
    description='Configure XGBoost GPU execution when available.',
    category='gpu',
    defaults={'tree_method': 'hist', 'device': 'cuda'},
    tags=["xgboost", "gpu", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
