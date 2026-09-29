from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='checkpoint_integrity_validation', category='reliability', description='Apply checkpoint integrity validation', transform=set_if_absent('checkpoint_integrity_validation', True), tags=('reliability', 'common'))

def create_strategy():
    return STRATEGY
