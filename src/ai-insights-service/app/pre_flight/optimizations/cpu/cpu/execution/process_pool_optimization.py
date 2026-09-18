"""CPU optimization strategy: process_pool_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='process_pool_optimization',
    category='execution',
    description='Apply process pool optimization.',
    transform=set_if_absent('process_pool_optimization', True),
    tags=("cpu", 'execution'),
)


def create_strategy():
    return STRATEGY
