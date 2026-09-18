from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='quantization_aware_training', category='model', description='Apply quantization aware training', transform=set_if_absent('quantization_aware_training', True), tags=('model', 'common'))

def create_strategy():
    return STRATEGY
