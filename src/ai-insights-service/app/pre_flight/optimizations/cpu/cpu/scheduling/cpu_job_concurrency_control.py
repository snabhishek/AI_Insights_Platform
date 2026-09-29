"""CPU optimization strategy: cpu_job_concurrency_control."""

from .._shared import create_strategy, set_if_absent

STRATEGY = create_strategy(
    name='cpu_job_concurrency_control',
    category='scheduling',
    description='Apply cpu job concurrency control.',
    transform=set_if_absent('cpu_job_concurrency_control', 'auto'),
    tags=("cpu", 'scheduling'),
)


def create_strategy():
    return STRATEGY
