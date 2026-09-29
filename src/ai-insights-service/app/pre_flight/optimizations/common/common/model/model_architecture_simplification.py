from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='model_architecture_simplification', category='model', description='Apply model architecture simplification', transform=set_if_absent('model_architecture_simplification', True), tags=('model', 'common'))

def create_strategy():
    return STRATEGY
