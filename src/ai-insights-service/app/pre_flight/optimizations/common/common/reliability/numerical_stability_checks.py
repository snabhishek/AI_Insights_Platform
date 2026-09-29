from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='numerical_stability_checks', category='reliability', description='Apply numerical stability checks', transform=set_if_absent('numerical_stability_checks', True), tags=('reliability', 'common'))

def create_strategy():
    return STRATEGY
