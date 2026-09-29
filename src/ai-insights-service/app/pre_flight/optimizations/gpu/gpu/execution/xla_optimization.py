"""GPU optimization strategy: xla_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='xla_optimization',
    category='execution',
    description='Apply xla optimization.',
    transform=set_if_absent('xla_optimization', True),
    tags=("gpu", 'execution'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
