"""GPU optimization strategy: optimizer_state_offload."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='optimizer_state_offload',
    category='memory',
    description='Apply optimizer state offload.',
    transform=set_if_absent('optimizer_state_offload', True),
    tags=("gpu", 'memory'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
