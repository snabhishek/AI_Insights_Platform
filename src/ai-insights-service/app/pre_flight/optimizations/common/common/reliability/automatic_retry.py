from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='automatic_retry', category='reliability', description='Apply automatic retry', transform=set_if_absent('max_retries', 2), tags=('reliability', 'common'))

def create_strategy():
    return STRATEGY
