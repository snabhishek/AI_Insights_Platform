from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='class_balancing', category='data', description='Apply class balancing', transform=set_if_absent('class_balancing', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
