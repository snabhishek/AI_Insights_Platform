from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='sequence_length_optimization', category='data', description='Apply sequence length optimization', transform=set_if_absent('max_sequence_length', 512), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
