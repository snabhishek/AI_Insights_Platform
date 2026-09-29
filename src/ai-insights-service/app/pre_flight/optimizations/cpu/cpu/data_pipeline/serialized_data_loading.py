"""CPU optimization strategy: serialized_data_loading."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='serialized_data_loading',
    category='data_pipeline',
    description='Apply serialized data loading.',
    transform=set_if_absent('serialized_data_loading', True),
    tags=("cpu", 'data_pipeline'),
)


def create_strategy():
    return STRATEGY
