from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='model_quantization', category='model', description='Apply model quantization', transform=set_if_absent('model_quantization', True), tags=('model', 'common'))

def create_strategy():
    return STRATEGY
