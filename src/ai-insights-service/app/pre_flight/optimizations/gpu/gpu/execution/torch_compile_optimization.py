"""GPU optimization strategy: torch_compile_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='torch_compile_optimization',
    category='execution',
    description='Apply torch compile optimization.',
    transform=set_if_absent('torch_compile_optimization', True),
    tags=("gpu", 'execution'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
