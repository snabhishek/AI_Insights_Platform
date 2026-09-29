"""CPU optimization strategy: cpu_jit_compilation."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_jit_compilation',
    category='computation',
    description='Apply cpu jit compilation.',
    transform=set_if_absent('cpu_jit_compilation', True),
    tags=("cpu", 'computation'),
)


def create_strategy():
    return STRATEGY
