from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='model_width_depth_scaling', category='model', description='Apply model width depth scaling', transform=set_if_absent('model_width_depth_scaling', True), tags=('model', 'common'))

def create_strategy():
    return STRATEGY
