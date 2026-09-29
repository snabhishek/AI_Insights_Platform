"""GPU optimization strategy: gpu_graph_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gpu_graph_optimization',
    category='execution',
    description='Apply gpu graph optimization.',
    transform=set_if_absent('gpu_graph_optimization', True),
    tags=("gpu", 'execution'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
