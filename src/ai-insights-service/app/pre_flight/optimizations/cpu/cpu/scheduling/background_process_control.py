"""CPU optimization strategy: background_process_control."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='background_process_control',
    category='scheduling',
    description='Apply background process control.',
    transform=set_if_absent('background_process_control', True),
    tags=("cpu", 'scheduling'),
)


def create_strategy():
    return STRATEGY
