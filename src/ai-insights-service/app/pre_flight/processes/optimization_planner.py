from ..models import OptimizationProposal, Bottleneck


class OptimizationPlanner:

    def plan(self, config, capability, system, estimate, bottleneck):
        order = {
            'ram': [
                'batch_size_reduction', 'gradient_accumulation',
                'data_chunking', 'worker_count_reduction', 'cpu_threads_limit'
            ],
            'vram': [
                'batch_size_reduction', 'gradient_accumulation',
                'mixed_precision', 'gradient_checkpointing'
            ],
            'cpu': [
                'cpu_threads_limit', 'worker_count_reduction', 'data_chunking',
                'data_sampling'
            ],
            'data_io': ['data_prefetching', 'data_chunking'],
            'unknown': ['batch_size_reduction', 'worker_count_reduction']
        }
        names = order.get(bottleneck.value, [])
        supported = set(capability.optimizations)
        return [
            OptimizationProposal(n, 'runtime', True,
                                 'Selected for detected bottleneck')
            for n in names if n in supported
        ]
