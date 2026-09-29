"""CPU optimization strategy: mkl_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='mkl_optimization',
    category='numerical_backends',
    description='Apply mkl optimization.',
    transform=set_if_absent('mkl_optimization', True),
    tags=("cpu", 'numerical_backends'),
)


def create_strategy():
    return STRATEGY
