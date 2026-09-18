"""CPU optimization strategy: cpu_rnn_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_rnn_optimization',
    category='model',
    description='Apply cpu rnn optimization.',
    transform=set_if_absent('cpu_rnn_optimization', True),
    tags=("cpu", 'model'),
)


def create_strategy():
    return STRATEGY
