"""GPU optimization strategy: cuda_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cuda_optimization',
    category='execution',
    description='Apply cuda optimization.',
    transform=set_if_absent('cuda_optimization', True),
    tags=("gpu", 'execution'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
