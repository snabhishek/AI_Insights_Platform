"""GPU optimization strategy: device_to_host_transfer."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='device_to_host_transfer',
    category='data_transfer',
    description='Apply device to host transfer.',
    transform=set_if_absent('device_to_host_transfer', True),
    tags=("gpu", 'data_transfer'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
