"""GPU optimization strategy: distributed_cpu_training."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='distributed_cpu_training',
    category='distributed',
    description='Apply distributed cpu training.',
    transform=set_if_absent('distributed_cpu_training', True),
    tags=("gpu", 'distributed'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
