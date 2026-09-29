"""Strategy: tensor_lifetime_optimization."""
from ._shared import make_strategy, clone_strategy

STRATEGY = make_strategy(
    name='tensor_lifetime_optimization',
    description='Release tensors as soon as they are no longer needed.',
    category='tensor_lifetime',
    priority="high",
    tags=["memory", 'tensor_lifetime'],
    defaults={'release_intermediates': True, 'allow_inplace_ops': False},
)

def create_strategy():
    """Return an independent strategy copy."""
    return clone_strategy(STRATEGY)
