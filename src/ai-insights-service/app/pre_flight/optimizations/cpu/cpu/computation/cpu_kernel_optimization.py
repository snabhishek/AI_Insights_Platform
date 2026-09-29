"""CPU optimization strategy: cpu_kernel_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_kernel_optimization',
    category='computation',
    description='Apply cpu kernel optimization.',
    transform=set_if_absent('cpu_kernel_optimization', True),
    tags=("cpu", 'computation'),
)


def create_strategy():
    return STRATEGY
