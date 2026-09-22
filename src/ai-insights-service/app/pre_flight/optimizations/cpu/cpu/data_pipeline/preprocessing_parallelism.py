"""CPU optimization strategy: preprocessing_parallelism."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='preprocessing_parallelism',
    category='data_pipeline',
    description='Apply preprocessing parallelism.',
    transform=set_if_absent('preprocessing_parallelism', True),
    tags=("cpu", 'data_pipeline'),
)


def create_strategy():
    return STRATEGY
