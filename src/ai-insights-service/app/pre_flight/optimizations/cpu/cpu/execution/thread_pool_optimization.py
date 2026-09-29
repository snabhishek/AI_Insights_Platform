"""CPU optimization strategy: thread_pool_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='thread_pool_optimization',
    category='execution',
    description='Apply thread pool optimization.',
    transform=set_if_absent('thread_pool_optimization', True),
    tags=("cpu", 'execution'),
)


def create_strategy():
    return STRATEGY
