"""CPU optimization strategy: cpu_cache_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_cache_optimization',
    category='computation',
    description='Apply cpu cache optimization.',
    transform=set_if_absent('cpu_cache_optimization', True),
    tags=("cpu", 'computation'),
)


def create_strategy():
    return STRATEGY
