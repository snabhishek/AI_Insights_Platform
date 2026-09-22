from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='training_divergence_detection', category='reliability', description='Apply training divergence detection', transform=set_if_absent('training_divergence_detection', True), tags=('reliability', 'common'))

def create_strategy():
    return STRATEGY
