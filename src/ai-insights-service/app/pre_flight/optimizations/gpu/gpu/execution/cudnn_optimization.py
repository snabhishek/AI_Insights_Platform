"""GPU optimization strategy: cudnn_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cudnn_optimization',
    category='execution',
    description='Apply cudnn optimization.',
    transform=set_if_absent('cudnn_optimization', True),
    tags=("gpu", 'execution'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
