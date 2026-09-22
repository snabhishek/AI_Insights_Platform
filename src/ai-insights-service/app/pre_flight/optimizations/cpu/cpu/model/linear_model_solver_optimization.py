"""CPU optimization strategy: linear_model_solver_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='linear_model_solver_optimization',
    category='model',
    description='Apply linear model solver optimization.',
    transform=set_if_absent('linear_model_solver_optimization', True),
    tags=("cpu", 'model'),
)


def create_strategy():
    return STRATEGY
