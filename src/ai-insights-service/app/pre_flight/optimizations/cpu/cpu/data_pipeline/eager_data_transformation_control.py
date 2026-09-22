"""CPU optimization strategy: eager_data_transformation_control."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='eager_data_transformation_control',
    category='data_pipeline',
    description='Apply eager data transformation control.',
    transform=set_if_absent('eager_data_transformation_control', True),
    tags=("cpu", 'data_pipeline'),
)


def create_strategy():
    return STRATEGY
