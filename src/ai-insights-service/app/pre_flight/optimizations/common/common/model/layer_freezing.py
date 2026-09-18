from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='layer_freezing', category='model', description='Apply layer freezing', transform=set_if_absent('layer_freezing', True), tags=('model', 'common'))

def create_strategy():
    return STRATEGY
