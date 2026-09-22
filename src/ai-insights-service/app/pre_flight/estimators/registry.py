from importlib import import_module

ESTIMATORS = {}
_MODULES = [
    ('resource', 'ram_estimator'),
    ('resource', 'vram_estimator'),
    ('resource', 'cpu_estimator'),
    ('resource', 'gpu_estimator'),
    ('resource', 'disk_storage_estimator'),
    ('resource', 'peak_memory_estimator'),
    ('resource', 'training_resource_estimator'),
    ('resource', 'inference_resource_estimator'),
    ('training', 'training_time_estimator'),
    ('training', 'epoch_time_estimator'),
    ('training', 'iteration_time_estimator'),
    ('training', 'throughput_estimator'),
    ('training', 'batch_size_estimator'),
    ('training', 'steps_estimator'),
    ('training', 'convergence_estimator'),
    ('training', 'total_training_cost_estimator'),
    ('model', 'model_parameter_estimator'),
    ('model', 'model_size_estimator'),
    ('model', 'model_complexity_estimator'),
    ('model', 'computational_cost_estimator'),
    ('model', 'flops_estimator'),
    ('model', 'inference_latency_estimator'),
    ('model', 'model_memory_estimator'),
    ('data', 'dataset_size_estimator'),
    ('data', 'dataset_memory_estimator'),
    ('data', 'feature_memory_estimator'),
    ('data', 'preprocessing_time_estimator'),
    ('data', 'data_loading_time_estimator'),
    ('data', 'data_pipeline_throughput_estimator'),
    ('data', 'data_transfer_estimator'),
    ('optimization', 'optimization_memory_impact_estimator'),
    ('optimization', 'optimization_speedup_estimator'),
    ('optimization', 'optimization_overhead_estimator'),
    ('optimization', 'batch_size_impact_estimator'),
    ('optimization', 'precision_impact_estimator'),
    ('optimization', 'parallelism_impact_estimator'),
    ('optimization', 'optimization_roi_estimator'),
    ('distributed', 'multi_gpu_scaling_estimator'),
    ('distributed', 'distributed_training_time_estimator'),
    ('distributed', 'communication_overhead_estimator'),
    ('distributed', 'distributed_memory_estimator'),
    ('distributed', 'node_capacity_estimator'),
    ('distributed', 'scaling_efficiency_estimator'),
    ('confidence', 'estimator_confidence'),
    ('confidence', 'estimation_uncertainty'),
    ('confidence', 'historical_estimation_calibrator'),
    ('confidence', 'estimation_reliability'),
 ]

def load_estimators():
    for group, module_name in _MODULES:
        key = f"{group}.{module_name}"
        if key not in ESTIMATORS:
            module = import_module(f"{__package__}.{group}.{module_name}")
            ESTIMATORS[key] = module.create_estimator()
    return dict(ESTIMATORS)

def get_estimator(name):
    estimators = load_estimators()
    if name in estimators:
        return estimators[name]
    matches = [item for key, item in estimators.items() if item.name == name or key.rsplit(".", 1)[-1] == name]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise KeyError(f"Unknown estimator: {name}")
    raise KeyError(f"Ambiguous estimator name: {name}")
