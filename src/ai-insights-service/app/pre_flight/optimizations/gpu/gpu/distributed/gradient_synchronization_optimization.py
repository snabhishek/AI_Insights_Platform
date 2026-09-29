"""GPU optimization strategy: gradient_synchronization_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gradient_synchronization_optimization',
    category='distributed',
    description='Apply gradient synchronization optimization.',
    transform=set_if_absent('gradient_synchronization_optimization', True),
    tags=("gpu", 'distributed'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
