"""CPU strategy registry."""

from importlib import import_module

CPU_MODULES = (
    'cpu.execution.cpu_thread_optimization',
    'cpu.execution.cpu_core_allocation',
    'cpu.execution.cpu_affinity',
    'cpu.execution.thread_pinning',
    'cpu.execution.thread_pool_optimization',
    'cpu.execution.process_pool_optimization',
    'cpu.execution.cpu_parallelism_optimization',
    'cpu.execution.intra_op_thread_optimization',
    'cpu.execution.inter_op_thread_optimization',
    'cpu.execution.oversubscription_control',
    'cpu.computation.cpu_vectorization',
    'cpu.computation.simd_optimization',
    'cpu.computation.cpu_cache_optimization',
    'cpu.computation.memory_layout_optimization',
    'cpu.computation.operation_fusion',
    'cpu.computation.cpu_jit_compilation',
    'cpu.computation.cpu_graph_optimization',
    'cpu.computation.cpu_kernel_optimization',
    'cpu.computation.branch_prediction_optimization',
    'cpu.numerical_backends.blas_backend_selection',
    'cpu.numerical_backends.mkl_optimization',
    'cpu.numerical_backends.openblas_optimization',
    'cpu.numerical_backends.onednn_optimization',
    'cpu.numerical_backends.lapack_backend_optimization',
    'cpu.numerical_backends.cpu_math_library_selection',
    'cpu.memory.cpu_ram_budgeting',
    'cpu.memory.cpu_memory_pooling',
    'cpu.memory.array_copy_reduction',
    'cpu.memory.tensor_copy_reduction',
    'cpu.memory.memory_alignment',
    'cpu.memory.shared_memory_optimization',
    'cpu.memory.mmap_dataset_loading',
    'cpu.memory.ram_pressure_detection',
    'cpu.memory.swap_usage_protection',
    'cpu.data_pipeline.cpu_data_loader_workers',
    'cpu.data_pipeline.cpu_prefetch_workers',
    'cpu.data_pipeline.preprocessing_parallelism',
    'cpu.data_pipeline.feature_engineering_parallelism',
    'cpu.data_pipeline.batch_preprocessing',
    'cpu.data_pipeline.lazy_data_transformation',
    'cpu.data_pipeline.eager_data_transformation_control',
    'cpu.data_pipeline.dataset_partitioning',
    'cpu.data_pipeline.csv_reader_optimization',
    'cpu.data_pipeline.parquet_reader_optimization',
    'cpu.data_pipeline.serialized_data_loading',
    'cpu.model.cpu_model_size_reduction',
    'cpu.model.cpu_friendly_model_selection',
    'cpu.model.tree_model_thread_optimization',
    'cpu.model.linear_model_solver_optimization',
    'cpu.model.cpu_rnn_optimization',
    'cpu.model.cpu_transformer_optimization',
    'cpu.model.cpu_time_series_optimization',
    'cpu.scheduling.cpu_job_queue_optimization',
    'cpu.scheduling.cpu_resource_reservation',
    'cpu.scheduling.cpu_load_balancing',
    'cpu.scheduling.cpu_job_concurrency_control',
    'cpu.scheduling.background_process_control',
    'cpu.scheduling.cpu_thermal_throttling_detection',
)


def load_cpu_strategies():
    """Load all CPU strategies keyed by strategy name."""
    loaded = {}
    for module_name in CPU_MODULES:
        module = import_module("." + module_name, package=__package__)
        strategy = module.create_strategy()
        loaded[strategy.spec.name] = strategy
    return loaded
