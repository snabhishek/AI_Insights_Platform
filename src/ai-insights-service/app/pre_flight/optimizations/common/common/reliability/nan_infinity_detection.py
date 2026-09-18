from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='nan_infinity_detection', category='reliability', description='Apply nan infinity detection', transform=set_if_absent('nan_infinity_detection', True), tags=('reliability', 'common'))

def create_strategy():
    return STRATEGY
