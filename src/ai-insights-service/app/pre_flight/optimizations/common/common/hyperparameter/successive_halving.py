from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='successive_halving', category='hyperparameter', description='Apply successive halving', transform=set_if_absent('successive_halving', True), tags=('hyperparameter', 'common'))

def create_strategy():
    return STRATEGY
