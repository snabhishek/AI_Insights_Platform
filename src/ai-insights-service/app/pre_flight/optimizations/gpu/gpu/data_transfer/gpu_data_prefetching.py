"""GPU optimization strategy: gpu_data_prefetching."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gpu_data_prefetching',
    category='data_transfer',
    description='Apply gpu data prefetching.',
    transform=set_if_absent('gpu_data_prefetching', True),
    tags=("gpu", 'data_transfer'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
