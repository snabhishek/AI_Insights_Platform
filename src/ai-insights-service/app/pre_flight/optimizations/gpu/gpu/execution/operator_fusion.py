"""GPU optimization strategy: operator_fusion."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='operator_fusion',
    category='execution',
    description='Apply operator fusion.',
    transform=set_if_absent('operator_fusion', True),
    tags=("gpu", 'execution'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
