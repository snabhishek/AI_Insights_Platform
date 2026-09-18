"""GPU optimization strategy: async_data_transfer."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='async_data_transfer',
    category='data_transfer',
    description='Apply async data transfer.',
    transform=set_if_absent('async_data_transfer', True),
    tags=("gpu", 'data_transfer'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
