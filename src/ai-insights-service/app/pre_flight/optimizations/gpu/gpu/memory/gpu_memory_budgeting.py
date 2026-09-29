"""GPU optimization strategy: gpu_memory_budgeting."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='gpu_memory_budgeting',
    category='memory',
    description='Apply gpu memory budgeting.',
    transform=set_if_absent('gpu_memory_budget', 'auto'),
    tags=("gpu", 'memory'),
)


def create_strategy():
    """Return the reusable strategy instance."""
    return STRATEGY
