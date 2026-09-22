from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='optuna_optimization', category='hyperparameter', description='Apply optuna optimization', transform=set_if_absent('optuna_optimization', True), tags=('hyperparameter', 'common'))

def create_strategy():
    return STRATEGY
