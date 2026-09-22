from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='dynamic_epoch_allocation', category='training', description='Apply dynamic epoch allocation', transform=set_if_absent('dynamic_epoch_allocation', True), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
