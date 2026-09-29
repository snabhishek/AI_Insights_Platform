"""CPU optimization strategy: intra_op_thread_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='intra_op_thread_optimization',
    category='execution',
    description='Apply intra op thread optimization.',
    transform=set_if_absent('intra_op_thread_optimization', 'auto'),
    tags=("cpu", 'execution'),
)


def create_strategy():
    return STRATEGY
