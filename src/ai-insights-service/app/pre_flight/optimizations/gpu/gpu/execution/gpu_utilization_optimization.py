"""GPU optimization strategy: gpu_utilization_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gpu_utilization_optimization',
    category='execution',
    description='Apply gpu utilization optimization.',
    transform=set_if_absent('gpu_utilization_optimization', True),
    tags=("gpu", 'execution'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
