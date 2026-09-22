"""CPU optimization strategy: cpu_graph_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_graph_optimization',
    category='computation',
    description='Apply cpu graph optimization.',
    transform=set_if_absent('cpu_graph_optimization', True),
    tags=("cpu", 'computation'),
)


def create_strategy():
    return STRATEGY
