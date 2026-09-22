from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='memory_fragmentation_control', category='memory', description='Apply memory fragmentation control', transform=set_if_absent('memory_fragmentation_control', True), tags=('memory', 'common'))

def create_strategy():
    return STRATEGY
