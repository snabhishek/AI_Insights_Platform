"""Framework-specific strategy: lightgbm_data_sampling."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='lightgbm_data_sampling',
    framework='lightgbm',
    description='Configure LightGBM data sampling.',
    category='sampling',
    defaults={'bagging_fraction': 1.0, 'bagging_freq': 0, 'feature_fraction': 1.0},
    tags=["lightgbm", "sampling", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
