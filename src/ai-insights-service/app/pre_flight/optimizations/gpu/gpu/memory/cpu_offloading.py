"""GPU optimization strategy: cpu_offloading."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_offloading',
    category='memory',
    description='Apply cpu offloading.',
    transform=set_if_absent('cpu_offloading', True),
    tags=("gpu", 'memory'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
