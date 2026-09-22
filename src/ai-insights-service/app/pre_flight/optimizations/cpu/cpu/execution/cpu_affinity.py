"""CPU optimization strategy: cpu_affinity."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_affinity',
    category='execution',
    description='Apply cpu affinity.',
    transform=set_if_absent('cpu_affinity', 'auto'),
    tags=("cpu", 'execution'),
)


def create_strategy():
    return STRATEGY
