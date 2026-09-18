from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='transfer_learning', category='model', description='Apply transfer learning', transform=set_if_absent('transfer_learning', True), tags=('model', 'common'))

def create_strategy():
    return STRATEGY
