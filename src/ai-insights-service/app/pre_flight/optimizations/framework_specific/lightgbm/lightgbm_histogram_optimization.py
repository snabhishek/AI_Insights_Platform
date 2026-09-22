"""Framework-specific strategy: lightgbm_histogram_optimization."""

from .._shared import clone_strategy, make_strategy

STRATEGY = make_strategy(
    name='lightgbm_histogram_optimization',
    framework='lightgbm',
    description='Optimize LightGBM histogram construction.',
    category='histogram',
    defaults={'max_bin': 255, 'bin_construct_sample_cnt': 200000},
    tags=["lightgbm", "histogram", "optimization"],
)


def create_strategy():
    """Return an independent copy of this strategy definition."""
    return clone_strategy(STRATEGY)
