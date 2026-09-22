from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='duplicate_memory_copy_reduction', category='memory', description='Apply duplicate memory copy reduction', transform=set_if_absent('duplicate_memory_copy_reduction', True), tags=('memory', 'common'))

def create_strategy():
    return STRATEGY
