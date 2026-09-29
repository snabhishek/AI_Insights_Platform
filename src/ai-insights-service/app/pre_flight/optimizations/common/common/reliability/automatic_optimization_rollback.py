from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='automatic_optimization_rollback', category='reliability', description='Apply automatic optimization rollback', transform=set_if_absent('automatic_optimization_rollback', True), tags=('reliability', 'common'))

def create_strategy():
    return STRATEGY
