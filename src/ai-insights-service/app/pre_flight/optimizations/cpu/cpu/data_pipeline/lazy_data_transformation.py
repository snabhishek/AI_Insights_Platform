"""CPU optimization strategy: lazy_data_transformation."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='lazy_data_transformation',
    category='data_pipeline',
    description='Apply lazy data transformation.',
    transform=set_if_absent('lazy_data_transformation', True),
    tags=("cpu", 'data_pipeline'),
)


def create_strategy():
    return STRATEGY
