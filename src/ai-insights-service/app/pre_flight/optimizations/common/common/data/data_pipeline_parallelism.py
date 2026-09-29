from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='data_pipeline_parallelism', category='data', description='Apply data pipeline parallelism', transform=set_if_absent('data_pipeline_parallelism', True), tags=('data', 'common'))

def create_strategy():
    return STRATEGY
