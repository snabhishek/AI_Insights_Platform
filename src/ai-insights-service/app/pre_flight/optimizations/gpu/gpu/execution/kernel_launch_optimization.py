"""GPU optimization strategy: kernel_launch_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='kernel_launch_optimization',
    category='execution',
    description='Apply kernel launch optimization.',
    transform=set_if_absent('kernel_launch_optimization', True),
    tags=("gpu", 'execution'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
