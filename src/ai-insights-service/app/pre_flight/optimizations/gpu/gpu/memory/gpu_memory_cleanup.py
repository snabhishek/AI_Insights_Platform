"""GPU optimization strategy: gpu_memory_cleanup."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gpu_memory_cleanup',
    category='memory',
    description='Apply gpu memory cleanup.',
    transform=set_if_absent('gpu_memory_cleanup', True),
    tags=("gpu", 'memory'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
