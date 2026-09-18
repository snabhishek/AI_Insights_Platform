from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='warm_start_hyperparameter_search', category='hyperparameter', description='Apply warm start hyperparameter search', transform=set_if_absent('warm_start_hyperparameter_search', True), tags=('hyperparameter', 'common'))

def create_strategy():
    return STRATEGY
