"""CPU optimization strategy: tree_model_thread_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='tree_model_thread_optimization',
    category='model',
    description='Apply tree model thread optimization.',
    transform=set_if_absent('tree_model_thread_optimization', 'auto'),
    tags=("cpu", 'model'),
)


def create_strategy():
    return STRATEGY
