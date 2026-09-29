from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='gradient_accumulation', category='training', description='Apply gradient accumulation', transform=set_if_absent('gradient_accumulation', True), tags=('training', 'common'))

def create_strategy():
    return STRATEGY
