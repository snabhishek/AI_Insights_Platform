"""CPU optimization strategy: batch_preprocessing."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='batch_preprocessing',
    category='data_pipeline',
    description='Apply batch preprocessing.',
    transform=set_if_absent('batch_preprocessing', True),
    tags=("cpu", 'data_pipeline'),
)


def create_strategy():
    return STRATEGY
