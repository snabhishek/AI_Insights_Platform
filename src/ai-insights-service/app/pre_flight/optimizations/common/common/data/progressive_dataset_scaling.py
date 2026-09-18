from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='progressive_dataset_scaling', category='data', description='Apply progressive dataset scaling', transform=set_if_absent('progressive_dataset_scaling', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
