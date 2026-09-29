"""GPU optimization strategy: gpu_quantization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gpu_quantization',
    category='quantization',
    description='Apply gpu quantization.',
    transform=set_if_absent('gpu_quantization', True),
    tags=("gpu", 'quantization'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
