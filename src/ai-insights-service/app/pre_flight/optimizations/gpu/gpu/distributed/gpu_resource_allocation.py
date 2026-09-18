"""GPU optimization strategy: gpu_resource_allocation."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gpu_resource_allocation',
    category='distributed',
    description='Apply gpu resource allocation.',
    transform=set_if_absent('gpu_resource_allocation', True),
    tags=("gpu", 'distributed'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
