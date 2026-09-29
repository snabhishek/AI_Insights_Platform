"""CPU optimization strategy: cpu_vectorization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_vectorization',
    category='computation',
    description='Apply cpu vectorization.',
    transform=set_if_absent('cpu_vectorization', True),
    tags=("cpu", 'computation'),
)


def create_strategy():
    return STRATEGY
