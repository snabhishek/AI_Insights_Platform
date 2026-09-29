from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='failed_worker_recovery', category='reliability', description='Apply failed worker recovery', transform=set_if_absent('failed_worker_recovery', True), tags=('reliability', 'common'))

def create_strategy():
    return STRATEGY
