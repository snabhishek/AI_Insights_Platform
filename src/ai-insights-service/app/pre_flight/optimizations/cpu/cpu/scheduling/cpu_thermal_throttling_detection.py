"""CPU optimization strategy: cpu_thermal_throttling_detection."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_thermal_throttling_detection',
    category='scheduling',
    description='Apply cpu thermal throttling detection.',
    transform=set_if_absent('cpu_thermal_throttling_detection', True),
    tags=("cpu", 'scheduling'),
)


def create_strategy():
    return STRATEGY
