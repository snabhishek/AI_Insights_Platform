"""CPU optimization strategy: cpu_transformer_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_transformer_optimization',
    category='model',
    description='Apply cpu transformer optimization.',
    transform=set_if_absent('cpu_transformer_optimization', True),
    tags=("cpu", 'model'),
)


def create_strategy():
    return STRATEGY
