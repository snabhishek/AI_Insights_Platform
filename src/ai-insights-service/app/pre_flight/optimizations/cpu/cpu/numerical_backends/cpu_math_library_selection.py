"""CPU optimization strategy: cpu_math_library_selection."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_math_library_selection',
    category='numerical_backends',
    description='Apply cpu math library selection.',
    transform=set_if_absent('cpu_math_library_selection', True),
    tags=("cpu", 'numerical_backends'),
)


def create_strategy():
    return STRATEGY
