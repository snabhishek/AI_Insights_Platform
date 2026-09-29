from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='random_search', category='hyperparameter', description='Apply random search', transform=set_if_absent('random_search', True), tags=('hyperparameter', 'common'))

def create_strategy():
    return STRATEGY
