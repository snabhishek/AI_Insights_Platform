"""CPU optimization strategy: cpu_thread_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_thread_optimization',
    category='execution',
    description='Apply cpu thread optimization.',
    transform=set_if_absent('cpu_thread_optimization', 'auto'),
    tags=("cpu", 'execution'),
)


def create_strategy():
    return STRATEGY
