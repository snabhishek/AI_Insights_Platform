"""CPU optimization strategy: cpu_job_queue_optimization."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_job_queue_optimization',
    category='scheduling',
    description='Apply cpu job queue optimization.',
    transform=set_if_absent('cpu_job_queue_optimization', True),
    tags=("cpu", 'scheduling'),
)


def create_strategy():
    return STRATEGY
