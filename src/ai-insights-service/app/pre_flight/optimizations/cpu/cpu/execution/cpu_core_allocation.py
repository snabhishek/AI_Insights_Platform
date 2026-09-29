"""CPU optimization strategy: cpu_core_allocation."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_core_allocation',
    category='execution',
    description='Apply cpu core allocation.',
    transform=set_if_absent('cpu_core_allocation', 'auto'),
    tags=("cpu", 'execution'),
)


def create_strategy():
    return STRATEGY
