"""CPU optimization strategy: ram_pressure_detection."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='ram_pressure_detection',
    category='memory',
    description='Apply ram pressure detection.',
    transform=set_if_absent('ram_pressure_detection', True),
    tags=("cpu", 'memory'),
)


def create_strategy():
    return STRATEGY
