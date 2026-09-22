from ..models import (
    Bottleneck,
    Capability,
    DecisionStatus,
    ExecutionKind,
    ExecutionStrategy,
    HardwareEvaluationResult,
    OptimizationProposal,
    PreflightDecision,
    ResourceEstimate,
    SystemSnapshot,
)


class DecisionEngine:

    def decide(self,
               config,
               system: SystemSnapshot,
               capabilities: list[Capability],
               estimator,
               planner,
               safety_margin: float = 0.85) -> PreflightDecision:
        # Extract raw configuration and candidate models
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

        # Step 1: Check GPU Availability from actual environment
        gpu_available = bool(system.has_gpu and system.gpus and len(system.gpus) > 0)
        gpu = system.gpus[0] if gpu_available else None

        # Step 2: Evaluate Hardware Capability
        cpu_cap = next((c for c in capabilities if c.execution_kind == ExecutionKind.CPU), None)
        gpu_cap = next((c for c in capabilities if c.execution_kind == ExecutionKind.GPU), None) if gpu_available else None

        est = estimator.estimate(config, gpu_cap or cpu_cap, system)
        req_ram = est.required_ram_gb or 2.0
        req_vram = est.required_vram_gb if gpu_available else None
        disk_ok = (system.disk_free_gb >= 1.0)

        # Detect framework GPU support and runtime compatibility
        is_sklearn = ('sklearn' in framework or 'scikit-learn' in framework or
                      any(isinstance(c, dict) and ('sklearn' in str(c.get('framework', '')).lower() or
                                                   'scikit-learn' in str(c.get('framework', '')).lower())
                          for c in (candidates if isinstance(candidates, list) else [])))
        
        has_gpu_framework = any(f in framework for f in ('torch', 'pytorch', 'xgboost', 'lightgbm', 'catboost', 'cuda')) or any(
            isinstance(c, dict) and any(f in str(c.get('framework', '')).lower() for f in ('torch', 'pytorch', 'xgboost', 'lightgbm', 'catboost'))
            for c in (candidates if isinstance(candidates, list) else [])
        )
        framework_gpu_supported = has_gpu_framework or (not is_sklearn and bool(framework))

        cuda_runtime_missing = any('PyTorch CUDA runtime is not available' in str(w) for w in system.warnings) or any('GPU probe unavailable' in str(w) for w in system.warnings)
        gpu_runtime_compatible = gpu_available and (not cuda_runtime_missing or ('torch' not in framework and 'pytorch' not in framework and has_gpu_framework))

        gpu_eval = None
        gpu_feasible = False

        if gpu_available and gpu is not None:
            # Scenario A: GPU Available
            vram_avail = gpu.free_vram_gb
            vram_total = gpu.total_vram_gb
            vram_limit = vram_avail * safety_margin
            vram_sufficient = (req_vram is not None and req_vram <= vram_limit)
            gpu_constraints = []

            if not framework_gpu_supported:
                gpu_constraints.append(f"Framework '{framework or 'scikit-learn'}' does not natively support CUDA GPU execution; algorithms execute on CPU runtime.")
            if cuda_runtime_missing and ('torch' in framework or 'pytorch' in framework or not framework):
                gpu_constraints.append("PyTorch CUDA runtime is not available in the execution environment.")
            if not vram_sufficient and req_vram:
                gpu_constraints.append(f"Projected VRAM ({req_vram} GB) exceeds safe GPU allocation threshold ({round(vram_limit, 2)} GB).")

            gpu_feasible = vram_sufficient and framework_gpu_supported and gpu_runtime_compatible and disk_ok
            gpu_eval = HardwareEvaluationResult(
                resource='gpu',
                available=True,
                supported=framework_gpu_supported,
                memory_total_gb=vram_total,
                memory_available_gb=vram_avail,
                memory_required_gb=req_vram,
                memory_sufficient=vram_sufficient,
                runtime_compatible=gpu_runtime_compatible,
                compute_compatible=framework_gpu_supported,
                details=f"GPU '{gpu.name}': {vram_avail} GB free / {vram_total} GB total.",
                constraints=tuple(gpu_constraints),
            )

        # CPU Evaluation (Evaluated in both Scenario A and B)
        ram_limit = system.ram_available_gb * safety_margin
        ram_sufficient = (req_ram <= ram_limit)
        cpu_constraints = []

        if not disk_ok:
            cpu_constraints.append(f"Host disk space ({system.disk_free_gb} GB) is below the critical 1.0 GB safety threshold.")
        if not ram_sufficient:
            cpu_constraints.append(f"Projected RAM ({req_ram} GB) exceeds safe host RAM limit ({round(ram_limit, 2)} GB).")

        cpu_feasible = ram_sufficient and disk_ok
        cpu_eval = HardwareEvaluationResult(
            resource='cpu',
            available=True,
            supported=True,
            memory_total_gb=system.ram_total_gb,
            memory_available_gb=system.ram_available_gb,
            memory_required_gb=req_ram,
            memory_sufficient=ram_sufficient,
            runtime_compatible=True,
            compute_compatible=True,
            details=f"CPU host: {system.cpu_logical} logical cores ({system.cpu_physical} physical), {system.ram_available_gb} GB free / {system.ram_total_gb} GB total RAM.",
            constraints=tuple(cpu_constraints),
        )

        # Determine Primary Suitable Execution Resource
        if not disk_ok:
            selected_resource = 'none'
        elif gpu_feasible and framework_gpu_supported:
            selected_resource = 'gpu'
        elif cpu_feasible:
            selected_resource = 'cpu'
        elif gpu_available and framework_gpu_supported and gpu_runtime_compatible:
            selected_resource = 'gpu'
        else:
            selected_resource = 'cpu'

        # Step 3: Evaluate Direct Execution Feasibility
        if selected_resource == 'gpu' and gpu_feasible:
            reason = f"Direct GPU execution feasible: Model verified on {gpu.name} ({round(req_vram, 2)} GB VRAM required vs {gpu.free_vram_gb} GB available)."
            return self._build_decision(
                status=DecisionStatus.RUN_DIRECTLY,
                execution_kind=ExecutionKind.GPU,
                backend='cuda',
                device='cuda',
                bottleneck=Bottleneck.NONE,
                optimizations=(),
                estimate=est,
                reasons=(reason,),
                warnings=system.warnings,
                gpu_available=gpu_available,
                gpu_eval=gpu_eval,
                cpu_eval=cpu_eval,
                selected_resource='gpu',
                direct_feasible=True,
                opt_feasible=False,
                strategy=ExecutionStrategy.DIRECT_GPU,
                decision_reason=reason,
                constraints=gpu_eval.constraints if gpu_eval else (),
            )

        if selected_resource == 'cpu' and cpu_feasible:
            reason = f"Direct CPU execution feasible: System RAM ({system.ram_available_gb} GB available vs {round(req_ram, 2)} GB required) and {system.cpu_logical} cores verified."
            return self._build_decision(
                status=DecisionStatus.RUN_DIRECTLY,
                execution_kind=ExecutionKind.CPU,
                backend='cpu',
                device='cpu',
                bottleneck=Bottleneck.NONE,
                optimizations=(),
                estimate=est,
                reasons=(reason,),
                warnings=system.warnings,
                gpu_available=gpu_available,
                gpu_eval=gpu_eval,
                cpu_eval=cpu_eval,
                selected_resource='cpu',
                direct_feasible=True,
                opt_feasible=False,
                strategy=ExecutionStrategy.DIRECT_CPU,
                decision_reason=reason,
                constraints=cpu_eval.constraints,
            )

        # Step 4: Evaluate Optimization Feasibility
        if not disk_ok:
            reason = f"Critical host storage depletion: Available disk space ({system.disk_free_gb} GB) is below the minimum 1.0 GB threshold."
            return self._build_decision(
                status=DecisionStatus.BLOCKED,
                execution_kind=ExecutionKind.NONE,
                backend=None,
                device=None,
                bottleneck=Bottleneck.DISK,
                optimizations=(),
                estimate=est,
                reasons=(reason,),
                warnings=system.warnings,
                gpu_available=gpu_available,
                gpu_eval=gpu_eval,
                cpu_eval=cpu_eval,
                selected_resource='none',
                direct_feasible=False,
                opt_feasible=False,
                strategy=ExecutionStrategy.INFEASIBLE,
                decision_reason=reason,
                constraints=(reason,),
            )

        # If primary resource was GPU but direct execution was infeasible
        if selected_resource == 'gpu':
            # Check GPU optimizations
            gpu_props = planner.plan(config, gpu_cap, system, est, Bottleneck.VRAM)
            vram_with_opt = req_vram * 0.55 if req_vram else 1.0  # AMP cuts ~45% VRAM
            if gpu_available and gpu and (vram_with_opt <= gpu.free_vram_gb * safety_margin) and gpu_props and gpu_runtime_compatible:
                reason = f"Direct GPU execution exceeded safe VRAM headroom; execution enabled via GPU optimizations ({', '.join(p.name for p in gpu_props)})."
                return self._build_decision(
                    status=DecisionStatus.RUN_WITH_OPTIMIZATION,
                    execution_kind=ExecutionKind.GPU,
                    backend='cuda',
                    device='cuda',
                    bottleneck=Bottleneck.VRAM,
                    optimizations=tuple(gpu_props),
                    estimate=est,
                    reasons=(reason,),
                    warnings=system.warnings,
                    gpu_available=gpu_available,
                    gpu_eval=gpu_eval,
                    cpu_eval=cpu_eval,
                    selected_resource='gpu',
                    direct_feasible=False,
                    opt_feasible=True,
                    strategy=ExecutionStrategy.OPTIMIZED_GPU,
                    decision_reason=reason,
                    constraints=gpu_eval.constraints if gpu_eval else (),
                )

            # Failover to alternative resource: CPU
            if cpu_feasible:
                failover_reason = f"GPU execution infeasible ({gpu_eval.constraints[0] if gpu_eval and gpu_eval.constraints else 'insufficient VRAM'}); successfully failed over to direct CPU execution with sufficient host RAM ({system.ram_available_gb} GB free)."
                return self._build_decision(
                    status=DecisionStatus.RUN_DIRECTLY,
                    execution_kind=ExecutionKind.CPU,
                    backend='cpu',
                    device='cpu',
                    bottleneck=Bottleneck.NONE,
                    optimizations=(),
                    estimate=est,
                    reasons=(failover_reason,),
                    warnings=system.warnings,
                    gpu_available=gpu_available,
                    gpu_eval=gpu_eval,
                    cpu_eval=cpu_eval,
                    selected_resource='cpu',
                    direct_feasible=True,
                    opt_feasible=False,
                    strategy=ExecutionStrategy.DIRECT_CPU,
                    decision_reason=failover_reason,
                    constraints=gpu_eval.constraints if gpu_eval else (),
                )

            # Check if CPU with optimization is viable
            cpu_props = planner.plan(config, cpu_cap, system, est, Bottleneck.RAM)
            if cpu_props:
                failover_reason = f"GPU execution infeasible; successfully failed over to optimized CPU execution ({', '.join(p.name for p in cpu_props)})."
                return self._build_decision(
                    status=DecisionStatus.RUN_WITH_OPTIMIZATION,
                    execution_kind=ExecutionKind.CPU,
                    backend='cpu',
                    device='cpu',
                    bottleneck=Bottleneck.RAM,
                    optimizations=tuple(cpu_props),
                    estimate=est,
                    reasons=(failover_reason,),
                    warnings=system.warnings,
                    gpu_available=gpu_available,
                    gpu_eval=gpu_eval,
                    cpu_eval=cpu_eval,
                    selected_resource='cpu',
                    direct_feasible=False,
                    opt_feasible=True,
                    strategy=ExecutionStrategy.OPTIMIZED_CPU,
                    decision_reason=failover_reason,
                    constraints=cpu_eval.constraints,
                )

            # Infeasible on both
            infeasible_reason = "Execution infeasible: neither GPU nor CPU resources satisfy model execution requirements even with optimizations."
            return self._build_decision(
                status=DecisionStatus.BLOCKED,
                execution_kind=ExecutionKind.NONE,
                backend=None,
                device=None,
                bottleneck=Bottleneck.UNKNOWN,
                optimizations=(),
                estimate=est,
                reasons=(infeasible_reason,),
                warnings=system.warnings,
                gpu_available=gpu_available,
                gpu_eval=gpu_eval,
                cpu_eval=cpu_eval,
                selected_resource='none',
                direct_feasible=False,
                opt_feasible=False,
                strategy=ExecutionStrategy.INFEASIBLE,
                decision_reason=infeasible_reason,
                constraints=tuple(list(gpu_eval.constraints if gpu_eval else ()) + list(cpu_eval.constraints)),
            )

        # Selected resource is CPU and direct execution failed (e.g. RAM bottleneck)
        cpu_props = planner.plan(config, cpu_cap, system, est, Bottleneck.RAM)
        if cpu_props:
            reason = f"Direct CPU execution exceeded safe RAM limit; execution enabled via CPU optimizations ({', '.join(p.name for p in cpu_props)})."
            return self._build_decision(
                status=DecisionStatus.RUN_WITH_OPTIMIZATION,
                execution_kind=ExecutionKind.CPU,
                backend='cpu',
                device='cpu',
                bottleneck=Bottleneck.RAM,
                optimizations=tuple(cpu_props),
                estimate=est,
                reasons=(reason,),
                warnings=system.warnings,
                gpu_available=gpu_available,
                gpu_eval=gpu_eval,
                cpu_eval=cpu_eval,
                selected_resource='cpu',
                direct_feasible=False,
                opt_feasible=True,
                strategy=ExecutionStrategy.OPTIMIZED_CPU,
                decision_reason=reason,
                constraints=cpu_eval.constraints,
            )

        # If GPU was available and hasn't been tried
        if gpu_available and gpu and framework_gpu_supported and gpu_runtime_compatible:
            if gpu_feasible:
                reason = "CPU RAM capacity exceeded; successfully failed over to direct GPU execution with verified VRAM headroom."
                return self._build_decision(
                    status=DecisionStatus.RUN_DIRECTLY,
                    execution_kind=ExecutionKind.GPU,
                    backend='cuda',
                    device='cuda',
                    bottleneck=Bottleneck.NONE,
                    optimizations=(),
                    estimate=est,
                    reasons=(reason,),
                    warnings=system.warnings,
                    gpu_available=gpu_available,
                    gpu_eval=gpu_eval,
                    cpu_eval=cpu_eval,
                    selected_resource='gpu',
                    direct_feasible=True,
                    opt_feasible=False,
                    strategy=ExecutionStrategy.DIRECT_GPU,
                    decision_reason=reason,
                    constraints=cpu_eval.constraints,
                )
            gpu_props = planner.plan(config, gpu_cap, system, est, Bottleneck.VRAM)
            if gpu_props:
                reason = "CPU RAM capacity exceeded; successfully failed over to optimized GPU execution."
                return self._build_decision(
                    status=DecisionStatus.RUN_WITH_OPTIMIZATION,
                    execution_kind=ExecutionKind.GPU,
                    backend='cuda',
                    device='cuda',
                    bottleneck=Bottleneck.VRAM,
                    optimizations=tuple(gpu_props),
                    estimate=est,
                    reasons=(reason,),
                    warnings=system.warnings,
                    gpu_available=gpu_available,
                    gpu_eval=gpu_eval,
                    cpu_eval=cpu_eval,
                    selected_resource='gpu',
                    direct_feasible=False,
                    opt_feasible=True,
                    strategy=ExecutionStrategy.OPTIMIZED_GPU,
                    decision_reason=reason,
                    constraints=tuple(list(cpu_eval.constraints) + list(gpu_eval.constraints if gpu_eval else ())),
                )

        infeasible_reason = "No feasible execution strategy exists: system RAM and compute capacity do not satisfy model requirements."
        return self._build_decision(
            status=DecisionStatus.BLOCKED,
            execution_kind=ExecutionKind.NONE,
            backend=None,
            device=None,
            bottleneck=Bottleneck.RAM,
            optimizations=(),
            estimate=est,
            reasons=(infeasible_reason,),
            warnings=system.warnings,
            gpu_available=gpu_available,
            gpu_eval=gpu_eval,
            cpu_eval=cpu_eval,
            selected_resource='none',
            direct_feasible=False,
            opt_feasible=False,
            strategy=ExecutionStrategy.INFEASIBLE,
            decision_reason=infeasible_reason,
            constraints=cpu_eval.constraints,
        )

    def _build_decision(self, status, execution_kind, backend, device, bottleneck,
                        optimizations, estimate, reasons, warnings,
                        gpu_available, gpu_eval, cpu_eval, selected_resource,
                        direct_feasible, opt_feasible, strategy, decision_reason, constraints):
        return PreflightDecision(
            status=status,
            execution_kind=execution_kind,
            backend=backend,
            device=device,
            bottleneck=bottleneck,
            optimizations=optimizations,
            estimate=estimate,
            reasons=reasons,
            warnings=tuple(warnings),
            requires_validation=(status == DecisionStatus.RUN_WITH_OPTIMIZATION or estimate.confidence in ('low', 'insufficient_data')),
            gpu_available=gpu_available,
            gpu_evaluation=gpu_eval,
            cpu_evaluation=cpu_eval,
            selected_resource=selected_resource,
            direct_execution_feasible=direct_feasible,
            optimization_feasible=opt_feasible,
            selected_strategy=strategy,
            decision_reason=decision_reason,
            constraints_or_missing_requirements=tuple(constraints),
        )
