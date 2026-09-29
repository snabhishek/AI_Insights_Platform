"""GPU optimization strategy: gradient_checkpointing."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gradient_checkpointing',
    category='memory',
    description='Apply gradient checkpointing.',
    transform=set_if_absent('gradient_checkpointing', True),
    tags=("gpu", 'memory'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
