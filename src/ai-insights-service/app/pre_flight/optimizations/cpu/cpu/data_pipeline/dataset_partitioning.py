"""CPU optimization strategy: dataset_partitioning."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='dataset_partitioning',
    category='data_pipeline',
    description='Apply dataset partitioning.',
    transform=set_if_absent('dataset_partitioning', True),
    tags=("cpu", 'data_pipeline'),
)


def create_strategy():
    return STRATEGY
