"""CPU optimization strategy: cpu_ram_budgeting."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_ram_budgeting',
    category='memory',
    description='Apply cpu ram budgeting.',
    transform=set_if_absent('cpu_ram_budgeting', True),
    tags=("cpu", 'memory'),
)


def create_strategy():
    return STRATEGY
