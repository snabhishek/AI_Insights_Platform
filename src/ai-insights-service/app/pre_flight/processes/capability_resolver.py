from ..models import Capability, ExecutionKind, SystemSnapshot


class CapabilityResolver:

    def resolve(self, config, system):
        raw_cfg = config.get('configuration') if isinstance(config.get('configuration'), dict) else config
        model_sel = raw_cfg.get('model_selection') or config.get('model_selection') or {}
        candidates = (
            raw_cfg.get('models') or
            raw_cfg.get('candidate_models') or
            model_sel.get('models') or
            model_sel.get('candidates') or
            config.get('models') or
            config.get('candidate_models') or
            []
        )
        framework = str(
            raw_cfg.get('framework') or raw_cfg.get('model_framework') or
            config.get('framework') or config.get('model_framework') or ''
        ).lower()
        if not framework and isinstance(candidates, list) and candidates:
            first = candidates[0]
            if isinstance(first, dict):
                framework = str(first.get('framework') or first.get('library') or '').lower()

        cuda_runtime_missing = any('PyTorch CUDA runtime is not available' in str(w) for w in system.warnings)

        result = [
            Capability(ExecutionKind.CPU, 'cpu', True, 'CPU runtime available',
                       ('batch_size_reduction', 'gradient_accumulation',
                        'cpu_threads_limit', 'worker_count_reduction',
                        'data_chunking', 'data_sampling'))
        ]
        if system.has_gpu:
            gpu_supported = True
            reason = 'GPU detected and compatible'
            if framework in ('scikit-learn', 'sklearn'):
                gpu_supported = False
                reason = 'Scikit-Learn estimators execute on CPU; GPU accelerator not natively used'
            elif cuda_runtime_missing and ('torch' in framework or 'pytorch' in framework or not framework):
                reason = 'GPU hardware present, but PyTorch CUDA runtime is not available in environment'

            result.append(
                Capability(
                    ExecutionKind.GPU, 'cuda', gpu_supported,
                    reason,
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

