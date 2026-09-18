from ..models import Capability, ExecutionKind, SystemSnapshot


class CapabilityResolver:

    def resolve(self, config, system):
        framework = str(
            config.get('framework') or config.get('model_framework')
            or '').lower() or None
        result = [
            Capability(ExecutionKind.CPU, 'cpu', True, 'CPU runtime available',
                       ('batch_size_reduction', 'gradient_accumulation',
                        'cpu_threads_limit', 'worker_count_reduction',
                        'data_chunking', 'data_sampling'))
        ]
        if system.has_gpu:
            result.append(
                Capability(
                    ExecutionKind.GPU, 'cuda', True,
                    'GPU detected; framework adapter must validate support',
                    ('batch_size_reduction', 'gradient_accumulation',
                     'mixed_precision', 'gradient_checkpointing',
                     'data_prefetching', 'pinned_memory')))
        if len(system.gpus) > 1:
            result.append(
                Capability(
                    ExecutionKind.MULTI_GPU, 'cuda_multi', True,
                    'Multiple GPUs detected; distributed adapter required',
                    ('distributed_training', 'gradient_accumulation',
                     'mixed_precision')))
        return result
