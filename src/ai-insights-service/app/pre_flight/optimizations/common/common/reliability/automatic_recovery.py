from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='automatic_recovery', category='reliability', description='Apply automatic recovery', transform=set_if_absent('automatic_recovery', True), tags=('reliability', 'common'))

def create_strategy():
    return STRATEGY
