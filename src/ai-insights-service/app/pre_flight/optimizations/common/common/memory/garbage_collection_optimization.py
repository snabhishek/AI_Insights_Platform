from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='garbage_collection_optimization', category='memory', description='Apply garbage collection optimization', transform=set_if_absent('garbage_collection_optimization', True), tags=('memory', 'common'))

def create_strategy():
    return STRATEGY
