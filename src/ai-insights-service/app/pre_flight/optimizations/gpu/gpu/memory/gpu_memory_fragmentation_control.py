"""GPU optimization strategy: gpu_memory_fragmentation_control."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gpu_memory_fragmentation_control',
    category='memory',
    description='Apply gpu memory fragmentation control.',
    transform=set_if_absent('gpu_memory_fragmentation_control', True),
    tags=("gpu", 'memory'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
