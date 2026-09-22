"""CPU optimization strategy: cpu_parallelism_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_parallelism_optimization',
    category='execution',
    description='Apply cpu parallelism optimization.',
    transform=set_if_absent('cpu_parallelism_optimization', True),
    tags=("cpu", 'execution'),
)


def create_strategy():
    return STRATEGY
