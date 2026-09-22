"""GPU optimization strategy: tf32_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='tf32_optimization',
    category='precision',
    description='Apply tf32 optimization.',
    transform=set_if_absent('tf32', True),
    tags=("gpu", 'precision'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
