"""GPU optimization strategy: gpu_kernel_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gpu_kernel_optimization',
    category='execution',
    description='Apply gpu kernel optimization.',
    transform=set_if_absent('gpu_kernel_optimization', True),
    tags=("gpu", 'execution'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
