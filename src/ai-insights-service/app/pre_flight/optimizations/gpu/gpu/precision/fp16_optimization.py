"""GPU optimization strategy: fp16_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='fp16_optimization',
    category='precision',
    description='Apply fp16 optimization.',
    transform=set_if_absent('precision', 'fp16'),
    tags=("gpu", 'precision'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
