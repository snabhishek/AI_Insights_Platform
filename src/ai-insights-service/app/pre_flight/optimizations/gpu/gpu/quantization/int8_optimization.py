"""GPU optimization strategy: int8_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='int8_optimization',
    category='quantization',
    description='Apply int8 optimization.',
    transform=set_if_absent('quantization_bits', 8),
    tags=("gpu", 'quantization'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
