from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='sequence_length_bucketing', category='data', description='Apply sequence length bucketing', transform=set_if_absent('sequence_length_bucketing', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
