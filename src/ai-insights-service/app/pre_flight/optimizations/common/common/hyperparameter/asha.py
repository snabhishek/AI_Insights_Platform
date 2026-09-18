from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='asha', category='hyperparameter', description='Apply asha', transform=set_if_absent('asha', True), tags=('hyperparameter', 'common'))

def create_strategy():
    return STRATEGY
