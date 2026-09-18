from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='model_specific_optimization', category='model', description='Apply model specific optimization', transform=set_if_absent('model_specific_optimization', True), tags=('model', 'common'))

def create_strategy():
    return STRATEGY
