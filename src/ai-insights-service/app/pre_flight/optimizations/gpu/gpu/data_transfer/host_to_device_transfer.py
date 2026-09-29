"""GPU optimization strategy: host_to_device_transfer."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='host_to_device_transfer',
    category='data_transfer',
    description='Apply host to device transfer.',
    transform=set_if_absent('host_to_device_transfer', True),
    tags=("gpu", 'data_transfer'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
