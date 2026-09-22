from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='hyperband', category='hyperparameter', description='Apply hyperband', transform=set_if_absent('hyperband', True), tags=('hyperparameter', 'common'))

def create_strategy():
    return STRATEGY
