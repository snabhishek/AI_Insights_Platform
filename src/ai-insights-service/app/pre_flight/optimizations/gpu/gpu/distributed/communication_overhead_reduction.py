"""GPU optimization strategy: communication_overhead_reduction."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='communication_overhead_reduction',
    category='distributed',
    description='Apply communication overhead reduction.',
    transform=set_if_absent('communication_overhead_reduction', True),
    tags=("gpu", 'distributed'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
