from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='batch_size_optimization', category='training', description='Apply batch size optimization', transform=set_if_absent('batch_size', 32), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
