"""GPU optimization strategy: activation_memory_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='activation_memory_optimization',
    category='memory',
    description='Apply activation memory optimization.',
    transform=set_if_absent('activation_memory_optimization', True),
    tags=("gpu", 'memory'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
