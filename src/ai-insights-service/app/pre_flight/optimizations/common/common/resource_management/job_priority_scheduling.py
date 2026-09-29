from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(name='job_priority_scheduling', category='resource_management', description='Apply job priority scheduling', transform=set_if_absent('job_priority', 'normal'), tags=('resource_management', 'common'))

def create_strategy():
    return STRATEGY
