"""GPU optimization strategy: quantized_optimizer."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='quantized_optimizer',
    category='quantization',
    description='Apply quantized optimizer.',
    transform=set_if_absent('quantized_optimizer', True),
    tags=("gpu", 'quantization'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
