"""GPU optimization strategy: gpu_load_balancing."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gpu_load_balancing',
    category='distributed',
    description='Apply gpu load balancing.',
    transform=set_if_absent('gpu_load_balancing', True),
    tags=("gpu", 'distributed'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
