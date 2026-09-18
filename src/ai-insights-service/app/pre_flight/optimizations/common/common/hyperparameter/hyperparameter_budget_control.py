from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='hyperparameter_budget_control', category='hyperparameter', description='Apply hyperparameter budget control', transform=set_if_absent('hyperparameter_budget_control', True), tags=('hyperparameter', 'common'))

def create_strategy():
    return STRATEGY
