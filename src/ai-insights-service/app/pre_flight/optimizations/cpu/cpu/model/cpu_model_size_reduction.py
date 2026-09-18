"""CPU optimization strategy: cpu_model_size_reduction."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_model_size_reduction',
    category='model',
    description='Apply cpu model size reduction.',
    transform=set_if_absent('cpu_model_size_reduction', True),
    tags=("cpu", 'model'),
)


def create_strategy():
    return STRATEGY
