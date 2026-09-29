"""CPU optimization strategy: feature_engineering_parallelism."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='feature_engineering_parallelism',
    category='data_pipeline',
    description='Apply feature engineering parallelism.',
    transform=set_if_absent('feature_engineering_parallelism', True),
    tags=("cpu", 'data_pipeline'),
)


def create_strategy():
    return STRATEGY
