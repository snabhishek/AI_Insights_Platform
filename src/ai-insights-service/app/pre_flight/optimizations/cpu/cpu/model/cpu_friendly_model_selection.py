"""CPU optimization strategy: cpu_friendly_model_selection."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_friendly_model_selection',
    category='model',
    description='Apply cpu friendly model selection.',
    transform=set_if_absent('cpu_friendly_model_selection', True),
    tags=("cpu", 'model'),
)


def create_strategy():
    return STRATEGY
