"""GPU strategy registry."""

from importlib import import_module

GPU_MODULES = (
    'gpu.precision.mixed_precision_training',
    'gpu.precision.automatic_mixed_precision',
    'gpu.precision.gradient_scaling',
    'gpu.precision.fp16_optimization',
    'gpu.precision.bf16_optimization',
    'gpu.precision.tf32_optimization',
    'gpu.memory.gpu_batch_size_optimization',
    'gpu.memory.gpu_memory_budgeting',
    'gpu.memory.gradient_checkpointing',
    'gpu.memory.gpu_memory_fragmentation_control',
    'gpu.memory.gpu_memory_cleanup',
    'gpu.memory.activation_memory_optimization',
    'gpu.memory.optimizer_state_offload',
    'gpu.memory.cpu_offloading',
    'gpu.memory.gpu_memory_pooling',
    'gpu.memory.vram_pressure_detection',
    'gpu.execution.gpu_utilization_optimization',
    'gpu.execution.gpu_kernel_optimization',
    'gpu.execution.cuda_optimization',
    'gpu.execution.cudnn_optimization',
    'gpu.execution.operator_fusion',
    'gpu.execution.gpu_graph_optimization',
    'gpu.execution.model_compilation',
    'gpu.execution.torch_compile_optimization',
    'gpu.execution.xla_optimization',
    'gpu.execution.kernel_launch_optimization',
    'gpu.data_transfer.pinned_memory',
    'gpu.data_transfer.host_to_device_transfer',
    'gpu.data_transfer.device_to_host_transfer',
    'gpu.data_transfer.async_data_transfer',
    'gpu.data_transfer.gpu_data_prefetching',
    'gpu.data_transfer.transfer_overlap_optimization',
    'gpu.distributed.distributed_data_parallel',
    'gpu.distributed.distributed_cpu_training',
    'gpu.distributed.multi_gpu_batch_distribution',
    'gpu.distributed.gradient_synchronization_optimization',
    'gpu.distributed.communication_overhead_reduction',
    'gpu.distributed.gpu_load_balancing',
    'gpu.distributed.gpu_resource_allocation',
    'gpu.distributed.multi_gpu_strategy_selection',
    'gpu.quantization.gpu_quantization',
    'gpu.quantization.int8_optimization',
    'gpu.quantization.int4_optimization',
    'gpu.quantization.quantized_optimizer',
    'gpu.quantization.quantization_compatibility',
)


def load_gpu_strategies():
    """Load all GPU strategies keyed by strategy name."""
    loaded = {}
    for module_name in GPU_MODULES:
        module = import_module("." + module_name, package=__package__)
        strategy = module.create_strategy()
        loaded[strategy.spec.name] = strategy
    return loaded
