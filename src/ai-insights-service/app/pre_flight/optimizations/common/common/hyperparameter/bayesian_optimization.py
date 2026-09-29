from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='bayesian_optimization', category='hyperparameter', description='Apply bayesian optimization', transform=set_if_absent('bayesian_optimization', True), tags=('hyperparameter', 'common'))

def create_strategy():
    return STRATEGY
