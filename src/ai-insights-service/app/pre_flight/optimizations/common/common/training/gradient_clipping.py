from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='gradient_clipping', category='training', description='Apply gradient clipping', transform=set_if_absent('gradient_clipping', True), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
