from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='reduce_training_epochs', category='training', description='Apply reduce training epochs', transform=set_if_absent('epochs', 10), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
