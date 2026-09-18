from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='early_stopping', category='training', description='Apply early stopping', transform=set_if_absent('early_stopping', True), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
