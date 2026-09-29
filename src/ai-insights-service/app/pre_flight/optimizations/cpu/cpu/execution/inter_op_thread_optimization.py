"""CPU optimization strategy: inter_op_thread_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='inter_op_thread_optimization',
    category='execution',
    description='Apply inter op thread optimization.',
    transform=set_if_absent('inter_op_thread_optimization', 'auto'),
    tags=("cpu", 'execution'),
)


def create_strategy():
    return STRATEGY
