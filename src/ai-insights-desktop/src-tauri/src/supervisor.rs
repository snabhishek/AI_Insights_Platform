use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
#[allow(unused_imports)]
use tauri_plugin_notification::NotificationExt;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
mod windows_job {
    use std::ffi::c_void;
    use std::os::windows::io::RawHandle;

    #[repr(C)]
    #[allow(non_snake_case)]
    struct IO_COUNTERS {
        ReadOperationCount: u64,
        WriteOperationCount: u64,
        OtherOperationCount: u64,
        ReadTransferCount: u64,
        WriteTransferCount: u64,
        OtherTransferCount: u64,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        PerProcessUserTimeLimit: i64,
        PerJobUserTimeLimit: i64,
        LimitFlags: u32,
        MinimumWorkingSetSize: usize,
        MaximumWorkingSetSize: usize,
        ActiveProcessLimit: u32,
        Affinity: usize,
        PriorityClass: u32,
        SchedulingClass: u32,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
        IoInfo: IO_COUNTERS,
        ProcessMemoryLimit: usize,
        JobMemoryLimit: usize,
        PeakProcessMemoryLimit: usize,
        PeakJobMemoryLimit: usize,
    }

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x00002000;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: i32 = 9;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(lpJobAttributes: *const c_void, lpName: *const u16) -> RawHandle;
        fn SetInformationJobObject(
            hJob: RawHandle,
            JobObjectInformationClass: i32,
            lpJobObjectInformation: *const c_void,
            cbJobObjectInformationLength: u32,
        ) -> i32;
        fn AssignProcessToJobObject(hJob: RawHandle, hProcess: RawHandle) -> i32;
        fn CloseHandle(hObject: RawHandle) -> i32;
    }

    pub struct JobObject {
        handle: RawHandle,
    }

    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}

    impl JobObject {
        pub fn create() -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() || handle == (-1isize as RawHandle) {
                    return None;
                }

                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                let res = SetInformationJobObject(
                    handle,
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    &info as *const _ as *const c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );

                if res == 0 {
                    CloseHandle(handle);
                    return None;
                }

                Some(Self { handle })
            }
        }

        pub fn assign_process(&self, process_handle: RawHandle) -> bool {
            unsafe {
                if self.handle.is_null() || self.handle == (-1isize as RawHandle) {
                    return false;
                }
                AssignProcessToJobObject(self.handle, process_handle) != 0
            }
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            unsafe {
                if !self.handle.is_null() && self.handle != (-1isize as RawHandle) {
                    CloseHandle(self.handle);
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHealthStatus {
    pub backend_running: bool,
    pub backend_port: u16,
    pub python_running: bool,
    pub python_port: u16,
    pub docker_running: bool,
    pub postgres_running: bool,
    pub postgres_port: u16,
    pub litellm_running: bool,
    pub litellm_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DependencyStatus {
    pub docker_running: bool,
    pub postgres_running: bool,
    pub postgres_port: u16,
    pub litellm_running: bool,
    pub litellm_port: u16,
    pub node_installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupStatus {
    pub step: String,
    pub status: String,
    pub message: String,
}

pub struct ProcessSupervisor {
    backend_child: Option<Child>,
    python_child: Option<Child>,
    backend_pids: Vec<u32>,
    app_dir: PathBuf,
    startup_status: StartupStatus,
    #[cfg(target_os = "windows")]
    job_object: Option<windows_job::JobObject>,
}

impl ProcessSupervisor {
    pub fn new(app_dir: PathBuf) -> Self {
        #[cfg(target_os = "windows")]
        let job_object = windows_job::JobObject::create();

        Self {
            backend_child: None,
            python_child: None,
            backend_pids: Vec::new(),
            app_dir,
            startup_status: StartupStatus {
                step: "startup".to_string(),
                status: "running".to_string(),
                message: "Starting Compass services...".to_string(),
            },
            #[cfg(target_os = "windows")]
            job_object,
        }
    }

    fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
        let path = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Could not resolve Compass's user data directory: {error}"))?;
        std::fs::create_dir_all(&path).map_err(|error| {
            format!(
                "Could not create Compass's user data directory at {}: {error}",
                path.display()
            )
        })?;
        Ok(path)
    }

    fn read_runtime_env(path: &Path) -> Result<HashMap<String, String>, String> {
        let contents = std::fs::read_to_string(path).map_err(|error| {
            format!(
                "Could not read Compass service configuration at {}: {error}. Run dependency setup and try again.",
                path.display()
            )
        })?;
        let mut values = HashMap::new();
        for line in contents.lines().map(str::trim) {
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = line.split_once('=') {
                values.insert(key.trim().to_string(), value.trim().to_string());
            }
        }
        Ok(values)
    }

    fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
        std::fs::create_dir_all(destination).map_err(|error| {
            format!(
                "Could not create migration directory {}: {error}",
                destination.display()
            )
        })?;
        for entry in std::fs::read_dir(source).map_err(|error| {
            format!(
                "Could not read legacy data directory {}: {error}",
                source.display()
            )
        })? {
            let entry =
                entry.map_err(|error| format!("Could not read legacy data entry: {error}"))?;
            let source_path = entry.path();
            let destination_path = destination.join(entry.file_name());
            let file_type = entry.file_type().map_err(|error| {
                format!(
                    "Could not inspect legacy data entry {}: {error}",
                    source_path.display()
                )
            })?;
            if file_type.is_dir() {
                Self::copy_directory(&source_path, &destination_path)?;
            } else if file_type.is_file() && !destination_path.exists() {
                std::fs::copy(&source_path, &destination_path).map_err(|error| {
                    format!(
                        "Could not preserve legacy data from {} to {}: {error}",
                        source_path.display(),
                        destination_path.display()
                    )
                })?;
            }
        }
        Ok(())
    }

    /// Check if a local TCP port is responding
    pub fn is_port_open(port: u16) -> bool {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        TcpStream::connect(addr).is_ok()
    }

    /// Perform a minimal HTTP GET against a local service and return the HTTP status code (if any response)
    pub fn http_status(port: u16, path: &str) -> Option<u16> {
        use std::io::{Read, Write};
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let mut stream = TcpStream::connect(addr).ok()?;
        let req = format!(
            "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
            path, port
        );
        stream.write_all(req.as_bytes()).ok()?;
        let mut buf = [0u8; 64];
        let n = stream.read(&mut buf).ok()?;
        let head = String::from_utf8_lossy(&buf[..n]);
        head.split_whitespace().nth(1)?.parse::<u16>().ok()
    }

    /// Core backend is healthy only when /api/health answers 200 (DB connected, migrations done)
    pub fn is_backend_healthy() -> bool {
        Self::http_status(22000, "/api/health") == Some(200)
    }

    /// Python service is healthy only when /health answers 200
    pub fn is_python_healthy() -> bool {
        Self::http_status(22004, "/health") == Some(200)
    }

    /// LiteLLM is healthy when its liveliness endpoint answers with a non-error status
    pub fn is_litellm_healthy() -> bool {
        matches!(
            Self::http_status(22002, "/health/liveliness"),
            Some(200..=299)
        )
    }

    /// Locate Docker CLI binary across standard system and user locations
    pub fn find_docker_binary() -> Option<PathBuf> {
        let candidates = [
            PathBuf::from("docker"),
            PathBuf::from(r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"),
            PathBuf::from(r"C:\Program Files\Docker\Docker\resources\docker.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Docker\Docker\resources\bin\docker.exe"),
        ];
        for cand in &candidates {
            if cand.to_str() == Some("docker") {
                let mut cmd = Command::new(cand);
                cmd.arg("--version");
                #[cfg(target_os = "windows")]
                cmd.creation_flags(CREATE_NO_WINDOW);
                if cmd.output().map(|o| o.status.success()).unwrap_or(false) {
                    return Some(cand.clone());
                }
            } else if cand.exists() {
                return Some(cand.clone());
            }
        }

        #[cfg(target_os = "windows")]
        {
            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                let user_candidates = [
                    PathBuf::from(&local_app_data)
                        .join(r"Programs\DockerDesktop\resources\bin\docker.exe"),
                    PathBuf::from(&local_app_data)
                        .join(r"Programs\Docker\Docker\resources\bin\docker.exe"),
                ];
                for cand in &user_candidates {
                    if cand.exists() {
                        return Some(cand.clone());
                    }
                }
            }

            if let Ok(entries) = std::fs::read_dir(r"C:\Users") {
                for entry in entries.flatten() {
                    let p = entry
                        .path()
                        .join(r"AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe");
                    if p.exists() {
                        return Some(p);
                    }
                    let p2 = entry
                        .path()
                        .join(r"AppData\Local\Programs\Docker\Docker\resources\bin\docker.exe");
                    if p2.exists() {
                        return Some(p2);
                    }
                }
            }
        }

        None
    }

    /// Locate Docker Desktop executable across standard system and user locations
    pub fn find_docker_desktop() -> Option<PathBuf> {
        let possible_paths = [
            PathBuf::from(r"C:\Program Files\Docker\Docker\Docker Desktop.exe"),
            PathBuf::from(r"C:\Program Files\Docker\Docker\frontend\Docker Desktop.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Docker\Docker\Docker Desktop.exe"),
        ];
        for path in &possible_paths {
            if path.exists() {
                return Some(path.clone());
            }
        }

        #[cfg(target_os = "windows")]
        {
            if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
                let user_candidates = [
                    PathBuf::from(&local_app_data)
                        .join(r"Programs\DockerDesktop\Docker Desktop.exe"),
                    PathBuf::from(&local_app_data)
                        .join(r"Programs\Docker\Docker\Docker Desktop.exe"),
                ];
                for cand in &user_candidates {
                    if cand.exists() {
                        return Some(cand.clone());
                    }
                }
            }

            if let Ok(entries) = std::fs::read_dir(r"C:\Users") {
                for entry in entries.flatten() {
                    let p = entry
                        .path()
                        .join(r"AppData\Local\Programs\DockerDesktop\Docker Desktop.exe");
                    if p.exists() {
                        return Some(p);
                    }
                    let p2 = entry
                        .path()
                        .join(r"AppData\Local\Programs\Docker\Docker\Docker Desktop.exe");
                    if p2.exists() {
                        return Some(p2);
                    }
                }
            }
        }

        None
    }

    /// Check if Docker daemon is responsive using a cached status with non-blocking check
    pub fn is_docker_running() -> bool {
        static LAST_CHECK: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
        static CACHED_STATE: std::sync::atomic::AtomicBool =
            std::sync::atomic::AtomicBool::new(false);

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let last = LAST_CHECK.load(std::sync::atomic::Ordering::Relaxed);
        // Cache result for 3 seconds to avoid spawning rapid synchronous docker info processes
        if now - last < 3 && last > 0 {
            return CACHED_STATE.load(std::sync::atomic::Ordering::Relaxed);
        }

        // Fast check: If Docker Compose services (Postgres 22003 or LiteLLM 22002) are open, Docker engine is confirmed running
        if Self::is_port_open(22003) || Self::is_port_open(22002) {
            CACHED_STATE.store(true, std::sync::atomic::Ordering::Relaxed);
            LAST_CHECK.store(now, std::sync::atomic::Ordering::Relaxed);
            return true;
        }

        let docker_bin = Self::find_docker_binary().unwrap_or_else(|| PathBuf::from("docker"));

        // Run Docker's own readiness check off the UI thread; startup has no deadline.
        let (tx, rx) = std::sync::mpsc::channel();
        let docker_bin_clone = docker_bin.clone();
        std::thread::spawn(move || {
            let mut cmd = Command::new(docker_bin_clone);
            cmd.arg("info");
            #[cfg(target_os = "windows")]
            cmd.creation_flags(CREATE_NO_WINDOW);

            let ok = cmd.output().map(|o| o.status.success()).unwrap_or(false);
            let _ = tx.send(ok);
        });

        let is_running = rx.recv().unwrap_or(false);
        CACHED_STATE.store(is_running, std::sync::atomic::Ordering::Relaxed);
        LAST_CHECK.store(now, std::sync::atomic::Ordering::Relaxed);
        is_running
    }

    /// Ensure required environment storage directories exist
    pub fn ensure_storage_directories(app: &AppHandle) -> Result<PathBuf, String> {
        let data_dir = Self::app_data_dir(app)?;
        let workspaces_dir = data_dir.join("workspaces");
        let legacy_workspaces_dir = PathBuf::from(r"C:\AI Insights Platform\workspaces");
        if !workspaces_dir.exists() && legacy_workspaces_dir.exists() {
            log::info!(
                "[Supervisor] Preserving workspaces from legacy location {:?}",
                legacy_workspaces_dir
            );
            Self::copy_directory(&legacy_workspaces_dir, &workspaces_dir)?;
        } else {
            std::fs::create_dir_all(&workspaces_dir).map_err(|error| {
                format!(
                    "Could not create Compass workspace directory at {}: {error}",
                    workspaces_dir.display()
                )
            })?;
        }
        Ok(data_dir)
    }

    /// Start Docker Desktop if installed. Service readiness is checked by the startup loop.
    pub fn start_docker() -> Result<(), String> {
        if Self::is_docker_running() {
            log::info!("[Supervisor] Docker daemon is already running and healthy.");
            return Ok(());
        }

        log::info!("[Supervisor] Docker is not running. Attempting to start Docker Desktop...");

        #[cfg(target_os = "windows")]
        {
            // Start Docker Desktop background service if stopped
            let mut ps_svc = Command::new("powershell");
            ps_svc.args([
                "-NoProfile",
                "-Command",
                "Get-Service 'com.docker.service' -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'Running' } | Start-Service -ErrorAction SilentlyContinue",
            ]);
            ps_svc.creation_flags(CREATE_NO_WINDOW);
            if let Err(error) = ps_svc.output() {
                log::warn!("[Supervisor] Could not query Docker Desktop service state: {error}");
            }

            let docker_bin = Self::find_docker_binary().ok_or_else(|| {
                "Docker Desktop is not installed or its CLI could not be found. Run Compass dependency setup and try again.".to_string()
            })?;

            // Try starting via official Docker Desktop CLI in detached/headless mode
            log::info!("[Supervisor] Attempting anonymous start via `docker desktop start -d`...");
            let mut cli_cmd = Command::new(&docker_bin);
            cli_cmd.args(["desktop", "start", "-d"]);
            cli_cmd.creation_flags(CREATE_NO_WINDOW);
            let cli_launched = match cli_cmd.status() {
                Ok(status) => status.success(),
                Err(error) => {
                    log::warn!(
                        "[Supervisor] Docker Desktop CLI could not start the engine: {error}"
                    );
                    false
                }
            };

            if !cli_launched {
                // Check if Docker Desktop or com.docker.backend is already running
                let mut ps_proc = Command::new("powershell");
                ps_proc.args([
                    "-NoProfile",
                    "-Command",
                    "Get-Process 'Docker Desktop', 'com.docker.backend' -ErrorAction SilentlyContinue | Select-Object -First 1",
                ]);
                ps_proc.creation_flags(CREATE_NO_WINDOW);
                let proc_running = ps_proc
                    .output()
                    .map(|o| !o.stdout.is_empty())
                    .unwrap_or(false);

                if !proc_running {
                    if let Some(desktop_path) = Self::find_docker_desktop() {
                        log::info!(
                            "[Supervisor] Launching Docker Desktop anonymously from: {:?}",
                            desktop_path
                        );
                        let mut cmd = Command::new(desktop_path);
                        cmd.creation_flags(CREATE_NO_WINDOW);
                        cmd.spawn()
                            .map_err(|error| format!("Could not launch Docker Desktop: {error}"))?;
                    } else {
                        return Err("Docker Desktop is installed but its application could not be located. Run Compass dependency setup and try again.".to_string());
                    }
                }
            }

            Ok(())
        }

        #[cfg(not(target_os = "windows"))]
        {
            Err("The Compass Docker supervisor is currently supported only on Windows.".to_string())
        }
    }

    /// Ensure Docker Compose services (Postgres on 22003 & LiteLLM on 22002) are running
    pub fn start_docker_compose(
        app_dir: &PathBuf,
        app: &AppHandle,
    ) -> Result<(bool, bool), String> {
        let pg_ready = Self::is_port_open(22003);
        let llm_ready = Self::is_port_open(22002);
        if pg_ready && llm_ready {
            log::info!(
                "[Supervisor] Docker Compose services (Postgres :22003 & LiteLLM :22002) are already active."
            );
            return Ok((true, true));
        }

        let possible_compose_files = [
            app_dir.join("resources/docker/docker-compose.yml"),
            app_dir.join("docker/docker-compose.yml"),
            app_dir.join("../docker/docker-compose.yml"),
            app_dir.join("../../src/ai-insights-desktop/docker/docker-compose.yml"),
            app_dir.join("../../ai-insights-desktop/docker/docker-compose.yml"),
            app_dir.join("../ai-insights-backend/logs/docker-compose.yml"),
        ];

        let mut compose_file: Option<PathBuf> = None;
        for candidate in &possible_compose_files {
            if candidate.exists() {
                compose_file = Some(Self::normalize_path(candidate));
                break;
            }
        }

        let c_file = compose_file.ok_or_else(|| {
            "Compass could not find docker-compose.yml in its installed resources. Repair or reinstall Compass.".to_string()
        })?;
        log::info!(
            "[Supervisor] Launching unified Docker Compose stack from: {:?}",
            c_file
        );
        let compose_dir = c_file.parent().unwrap_or(app_dir);
        let data_dir = Self::app_data_dir(app)?;
        let postgres_data_dir = data_dir.join("data/postgres");
        std::fs::create_dir_all(&postgres_data_dir).map_err(|error| {
            format!(
                "Could not create PostgreSQL data directory at {}: {error}",
                postgres_data_dir.display()
            )
        })?;

        let env_file = data_dir.join("desktop.env");
        let settings = Self::read_runtime_env(&env_file)?;
        for key in [
            "COMPASS_DB_PASSWORD",
            "LITELLM_MASTER_KEY",
            "LITELLM_SALT_KEY",
        ] {
            if settings.get(key).map_or(true, |value| value.is_empty()) {
                return Err(format!(
                    "Compass service configuration is missing {key}. Run dependency setup and try again."
                ));
            }
        }

        let docker_bin = Self::find_docker_binary().ok_or_else(|| {
            "Docker CLI could not be found. Run Compass dependency setup and try again.".to_string()
        })?;
        let mut cmd = Command::new(&docker_bin);
        cmd.args([
            "compose",
            "--env-file",
            env_file.to_string_lossy().as_ref(),
            "-f",
            c_file
                .to_str()
                .ok_or_else(|| "Docker Compose resource path is not valid UTF-8.".to_string())?,
            "-p",
            "compass",
            "up",
            "-d",
            "--wait",
        ]);
        cmd.current_dir(compose_dir);
        cmd.env(
            "POSTGRES_DATA_DIR",
            postgres_data_dir.to_string_lossy().replace('\\', "/"),
        );
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd
            .output()
            .map_err(|error| format!("Failed to run Docker Compose: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Err(format!(
                "Docker Compose failed ({}): {}{}",
                output.status, stdout, stderr
            ));
        }
        log::info!("[Supervisor] Docker Compose stack started and reports healthy.");

        Ok((Self::is_port_open(22003), Self::is_port_open(22002)))
    }

    /// Normalize path by stripping Windows extended-length verbatim prefix (\\?\) which causes
    /// Node.js realpathSync/lstat 'C:' crashes (EISDIR) and breaks Python/Uvicorn path resolution.
    pub fn normalize_path<P: AsRef<Path>>(path: P) -> PathBuf {
        let s = path.as_ref().to_string_lossy();
        let cleaned = if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{}", stripped)
        } else if let Some(stripped) = s.strip_prefix(r"\\?\") {
            stripped.to_string()
        } else {
            s.to_string()
        };
        PathBuf::from(cleaned)
    }

    /// Resolve directory where services are located
    fn resolve_services_dir(&self, app: &AppHandle) -> (PathBuf, PathBuf) {
        // 1. Check if running in development mode (relative to repo root)
        let dev_backend = self.app_dir.join("../ai-insights-backend");
        let dev_python = self.app_dir.join("../ai-insights-service");
        if dev_backend.exists() && dev_python.exists() {
            return (
                Self::normalize_path(&dev_backend),
                Self::normalize_path(&dev_python),
            );
        }

        let dev_src_backend = self.app_dir.join("../../src/ai-insights-backend");
        let dev_src_python = self.app_dir.join("../../src/ai-insights-service");
        if dev_src_backend.exists() && dev_src_python.exists() {
            return (
                Self::normalize_path(&dev_src_backend),
                Self::normalize_path(&dev_src_python),
            );
        }

        // 2. Check resource directory in packaged installer mode
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled_res_backend = resource_dir.join("resources/services/backend");
            let bundled_res_python = resource_dir.join("resources/services/python-service");
            if bundled_res_backend.exists() || bundled_res_python.exists() {
                return (
                    Self::normalize_path(&bundled_res_backend),
                    Self::normalize_path(&bundled_res_python),
                );
            }

            let bundled_backend = resource_dir.join("services/backend");
            let bundled_python = resource_dir.join("services/python-service");
            if bundled_backend.exists() || bundled_python.exists() {
                return (
                    Self::normalize_path(&bundled_backend),
                    Self::normalize_path(&bundled_python),
                );
            }
        }

        // 3. Check relative to current executable directory
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let exe_res_backend = exe_dir.join("resources/services/backend");
                let exe_res_python = exe_dir.join("resources/services/python-service");
                if exe_res_backend.exists() || exe_res_python.exists() {
                    return (
                        Self::normalize_path(&exe_res_backend),
                        Self::normalize_path(&exe_res_python),
                    );
                }

                let exe_backend = exe_dir.join("services/backend");
                let exe_python = exe_dir.join("services/python-service");
                if exe_backend.exists() || exe_python.exists() {
                    return (
                        Self::normalize_path(&exe_backend),
                        Self::normalize_path(&exe_python),
                    );
                }
            }
        }

        // 4. Fallback to relative services folder
        let rel_backend = self.app_dir.join("resources/services/backend");
        let rel_python = self.app_dir.join("resources/services/python-service");
        if rel_backend.exists() || rel_python.exists() {
            return (
                Self::normalize_path(&rel_backend),
                Self::normalize_path(&rel_python),
            );
        }

        (
            Self::normalize_path(&self.app_dir.join("services/backend")),
            Self::normalize_path(&self.app_dir.join("services/python-service")),
        )
    }

    /// Resolve Node.js binary (bundled portable node.exe in resources/bin, standard Windows paths, or PATH)
    pub fn resolve_node_binary(&self, backend_dir: &PathBuf, app: &AppHandle) -> PathBuf {
        // 1. Check bundled node.exe in resources/bin/node.exe
        if let Ok(res_dir) = app.path().resource_dir() {
            let bundled_bin = res_dir.join("bin/node.exe");
            if bundled_bin.exists() {
                return Self::normalize_path(&bundled_bin);
            }
            let bundled_res_bin = res_dir.join("resources/bin/node.exe");
            if bundled_res_bin.exists() {
                return Self::normalize_path(&bundled_res_bin);
            }
        }
        let app_res_bin = self.app_dir.join("resources/bin/node.exe");
        if app_res_bin.exists() {
            return Self::normalize_path(&app_res_bin);
        }
        let app_bin = self.app_dir.join("bin/node.exe");
        if app_bin.exists() {
            return Self::normalize_path(&app_bin);
        }
        let backend_bin = backend_dir.join("bin/node.exe");
        if backend_bin.exists() {
            return Self::normalize_path(&backend_bin);
        }

        // 2. Check standard Windows installation paths
        #[cfg(target_os = "windows")]
        {
            let candidates = [
                PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
                PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
            ];
            for candidate in &candidates {
                if candidate.exists() {
                    return Self::normalize_path(candidate);
                }
            }
            if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
                let user_node = PathBuf::from(local_app).join(r"Programs\nodejs\node.exe");
                if user_node.exists() {
                    return Self::normalize_path(&user_node);
                }
            }
        }

        // 3. Fallback to system PATH
        PathBuf::from("node")
    }

    /// Start Backend process (Node.js Express)
    pub fn start_backend(
        &mut self,
        app: &AppHandle,
        pg_port: Option<u16>,
        litellm_port: Option<u16>,
    ) -> Result<(), String> {
        if Self::is_port_open(22000) {
            let pids = Self::find_pids_by_port(22000);
            if Self::is_backend_healthy() {
                log::info!("[Supervisor] Backend is already running and healthy on port 22000.");
                for pid in pids {
                    if !self.backend_pids.contains(&pid) {
                        self.backend_pids.push(pid);
                    }
                }
                return Ok(());
            }
            // Stale/unhealthy listener: replace it with a fresh backend instance
            log::warn!(
                "[Supervisor] Port 22000 is occupied by an unhealthy process {:?}; replacing it.",
                pids
            );
            #[cfg(target_os = "windows")]
            for pid in pids {
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
            std::thread::sleep(Duration::from_millis(500));
        }

        let (backend_dir, _) = self.resolve_services_dir(app);
        let backend_dir = Self::normalize_path(backend_dir);
        let node_exe = Self::normalize_path(self.resolve_node_binary(&backend_dir, app));
        log::info!(
            "[Supervisor] Starting backend from: {:?} using Node: {:?}",
            backend_dir,
            node_exe
        );

        // Auto-install or extract dependencies if node_modules is missing or incomplete
        let node_modules = backend_dir.join("node_modules");
        let core_check = node_modules.join("@langchain/core/dist/callbacks/manager.cjs");
        if !node_modules.exists() || !core_check.exists() {
            let archive_gz = backend_dir.join("node_modules.tar.gz");
            let archive_tar = backend_dir.join("node_modules.tar");
            let mut extracted = false;

            if archive_gz.exists() {
                log::info!(
                    "[Supervisor] Extracting backend node_modules.tar.gz in {:?}...",
                    backend_dir
                );
                let mut tar_cmd = Command::new("tar");
                tar_cmd.args(["-xzf", "node_modules.tar.gz"]);
                tar_cmd.current_dir(&backend_dir);
                #[cfg(target_os = "windows")]
                tar_cmd.creation_flags(CREATE_NO_WINDOW);
                let status_ok = tar_cmd.status().map(|s| s.success()).unwrap_or(false);
                if status_ok && core_check.exists() {
                    extracted = true;
                }
            } else if archive_tar.exists() {
                log::info!(
                    "[Supervisor] Extracting backend node_modules.tar in {:?}...",
                    backend_dir
                );
                let mut tar_cmd = Command::new("tar");
                tar_cmd.args(["-xf", "node_modules.tar"]);
                tar_cmd.current_dir(&backend_dir);
                #[cfg(target_os = "windows")]
                tar_cmd.creation_flags(CREATE_NO_WINDOW);
                let status_ok = tar_cmd.status().map(|s| s.success()).unwrap_or(false);
                if status_ok && core_check.exists() {
                    extracted = true;
                }
            }

            if !extracted && backend_dir.join("package.json").exists() {
                log::warn!(
                    "[Supervisor] Auto-installing backend production dependencies via npm in {:?}...",
                    backend_dir
                );
                let npm_bin = if cfg!(target_os = "windows") {
                    "npm.cmd"
                } else {
                    "npm"
                };
                let mut npm_cmd = Command::new(npm_bin);
                let npm_args = if backend_dir.join("package-lock.json").exists() {
                    ["ci", "--omit=dev", "--no-audit", "--no-fund"]
                } else {
                    ["install", "--omit=dev", "--no-audit", "--no-fund"]
                };
                npm_cmd.args(npm_args);
                npm_cmd.current_dir(&backend_dir);
                #[cfg(target_os = "windows")]
                npm_cmd.creation_flags(CREATE_NO_WINDOW);
                let output = npm_cmd.output().map_err(|error| {
                    format!("Could not install backend dependencies using {npm_bin}: {error}")
                })?;
                if !output.status.success() {
                    return Err(format!(
                        "Backend dependency installation failed ({}): {}{}",
                        output.status,
                        String::from_utf8_lossy(&output.stdout),
                        String::from_utf8_lossy(&output.stderr)
                    ));
                }
            }
        }

        if !core_check.exists() {
            return Err(format!(
                "Backend dependencies are missing or incomplete at {}. Run Compass dependency setup and try again.",
                node_modules.display()
            ));
        }

        let mut cmd = Command::new(&node_exe);
        cmd.arg("--max-old-space-size=8192");

        let dist_index = backend_dir.join("dist/index.js");
        if dist_index.exists() {
            // Use relative path since current_dir is set to backend_dir - avoids Windows UNC/realpath lstat 'C:' bugs in Node.js
            cmd.arg("dist/index.js");
        } else {
            if !backend_dir.join("src/index.ts").exists() {
                return Err(format!(
                    "Compiled backend entry point is missing: {}. Rebuild or repair Compass.",
                    dist_index.display()
                ));
            }
            cmd.args(["-r", "ts-node/register", "src/index.ts"]);
        }

        let data_dir = Self::app_data_dir(app)?;
        let runtime_env = Self::read_runtime_env(&data_dir.join("desktop.env"))?;
        let db_password = runtime_env.get("COMPASS_DB_PASSWORD").ok_or_else(|| {
            "Compass database password is not configured. Run dependency setup and try again."
                .to_string()
        })?;
        let litellm_master_key = runtime_env.get("LITELLM_MASTER_KEY").ok_or_else(|| {
            "LiteLLM authentication is not configured. Run dependency setup and try again."
                .to_string()
        })?;

        cmd.current_dir(&backend_dir);
        cmd.env("PORT", "22000");
        cmd.env("HOST", "127.0.0.1");
        cmd.env("AI_INSIGHTS_SERVICE_URL", "http://127.0.0.1:22004");
        cmd.env("FILE_SERVER_PATH", &data_dir);
        cmd.env("DB_HOST", "127.0.0.1");
        cmd.env("DB_USER", "postgres");
        cmd.env("DB_PASS", db_password);
        cmd.env("DB_NAME", "docspyre_app");

        let resolved_pg_port = pg_port.unwrap_or(22003);
        cmd.env("DB_PORT", resolved_pg_port.to_string());

        let resolved_litellm_port = litellm_port.unwrap_or(22002);
        cmd.env(
            "LITELLM_PROXY_URL",
            format!("http://127.0.0.1:{}", resolved_litellm_port),
        );
        cmd.env("LITELLM_MASTER_KEY", litellm_master_key);

        // Keep the active model and its LiteLLM virtual key across app upgrades.
        cmd.env("COMPASS_RUNTIME_ENV_FILE", data_dir.join("desktop.env"));
        if let Some(model) = runtime_env
            .get("LITELLM_MODEL")
            .or_else(|| runtime_env.get("LITELLM_MODEL_NAME"))
            .filter(|value| !value.is_empty())
        {
            cmd.env("LITELLM_MODEL", model);
            cmd.env("LITELLM_MODEL_NAME", model);
        }
        if let Some(virtual_key) = runtime_env
            .get("LITELLM_VIRTUAL_KEY")
            .filter(|value| !value.is_empty())
        {
            cmd.env("LITELLM_VIRTUAL_KEY", virtual_key);
        }
        if let Some(model_keys) = runtime_env
            .get("COMPASS_LITELLM_MODEL_KEYS")
            .filter(|value| !value.is_empty())
        {
            cmd.env("COMPASS_LITELLM_MODEL_KEYS", model_keys);
        }
        if let Some(provider) = runtime_env
            .get("AI_PROVIDER")
            .filter(|value| !value.is_empty())
        {
            cmd.env("AI_PROVIDER", provider);
        }

        let log_dir = data_dir.join("logs");
        std::fs::create_dir_all(&log_dir).map_err(|error| {
            format!(
                "Could not create backend log directory at {}: {error}",
                log_dir.display()
            )
        })?;
        let backend_log_path = log_dir.join("backend.log");
        let file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&backend_log_path)
            .map_err(|error| {
                format!(
                    "Could not open backend log at {}: {error}",
                    backend_log_path.display()
                )
            })?;
        let stderr_file = file.try_clone().map_err(|error| {
            format!(
                "Could not prepare backend log output at {}: {error}",
                backend_log_path.display()
            )
        })?;
        cmd.stdout(file);
        cmd.stderr(stderr_file);

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        match cmd.spawn() {
            Ok(child) => {
                let pid = child.id();
                log::info!("[Supervisor] Backend spawned with PID: {}", pid);
                self.backend_pids.push(pid);
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::io::AsRawHandle;
                    if let Some(ref job) = self.job_object {
                        let assigned = job.assign_process(child.as_raw_handle());
                        log::info!(
                            "[Supervisor] Backend assigned to Windows Job Object: {}",
                            assigned
                        );
                    }
                }
                self.backend_child = Some(child);
                Ok(())
            }
            Err(e) => Err(format!(
                "Failed to launch the core Node.js backend using {}: {e}",
                node_exe.display()
            )),
        }
    }

    /// Start Python service process (FastAPI / uvicorn)
    pub fn start_python_service(&mut self, app: &AppHandle) -> Result<(), String> {
        let (_, python_dir) = self.resolve_services_dir(app);
        let python_dir = Self::normalize_path(python_dir);
        let bundled_service = python_dir.join(if cfg!(target_os = "windows") {
            "ai-insights-service.exe"
        } else {
            "ai-insights-service"
        });

        if !bundled_service.is_file() {
            return Err(format!(
                "Required bundled Python service is missing: {}. Rebuild or reinstall the application.",
                bundled_service.display()
            ));
        }

        if Self::is_port_open(22004) {
            log::info!("[Supervisor] Python service is already running on port 22004.");
            return Ok(());
        }

        log::info!(
            "[Supervisor] Starting bundled Python service: {:?}",
            bundled_service
        );
        let mut cmd = Command::new(&bundled_service);
        cmd.args(["--host", "127.0.0.1", "--port", "22004"]);
        cmd.current_dir(&python_dir);

        let log_dir = Self::app_data_dir(app)?.join("logs");
        std::fs::create_dir_all(&log_dir).map_err(|error| {
            format!(
                "Could not create Python service log directory at {}: {error}",
                log_dir.display()
            )
        })?;
        let py_log_path = log_dir.join("python-service.log");
        let file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&py_log_path)
            .map_err(|error| {
                format!(
                    "Could not open Python service log at {}: {error}",
                    py_log_path.display()
                )
            })?;
        let stderr_file = file.try_clone().map_err(|error| {
            format!(
                "Could not prepare Python service log output at {}: {error}",
                py_log_path.display()
            )
        })?;
        cmd.stdout(file);
        cmd.stderr(stderr_file);

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let child = cmd.spawn().map_err(|error| {
            format!(
                "Failed to launch bundled Python service at {}: {error}",
                bundled_service.display()
            )
        })?;
        let pid = child.id();
        log::info!(
            "[Supervisor] Bundled Python service spawned with PID: {}",
            pid
        );
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::io::AsRawHandle;
            if let Some(ref job) = self.job_object {
                let assigned = job.assign_process(child.as_raw_handle());
                log::info!(
                    "[Supervisor] Python service assigned to Windows Job Object: {}",
                    assigned
                );
            }
        }
        self.python_child = Some(child);
        Ok(())
    }

    /// Terminate Node.js backend runtime processes
    pub fn stop_backend(&mut self) {
        log::info!("[Supervisor] Terminating Node.js backend runtime...");

        // 1. Terminate tracked child process if present
        if let Some(mut child) = self.backend_child.take() {
            let pid = child.id();
            log::info!("[Supervisor] Terminating backend child (PID: {})...", pid);
            #[cfg(target_os = "windows")]
            {
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
            let _ = child.kill();
            let _ = child.wait();
        }

        // 2. Terminate all tracked backend PIDs
        for pid in self.backend_pids.drain(..) {
            log::info!("[Supervisor] Terminating tracked backend PID {}...", pid);
            #[cfg(target_os = "windows")]
            {
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
        }

        // 3. Scan and kill any process listening on backend port 22000
        #[cfg(target_os = "windows")]
        {
            let port_pids = Self::find_pids_by_port(22000);
            for pid in port_pids {
                log::info!(
                    "[Supervisor] Terminating active process on backend port 22000 (PID: {})...",
                    pid
                );
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }

            // 4. Terminate any orphan node.exe processes running from the app resources directory
            Self::kill_backend_node_processes(&self.app_dir);
        }

        // 5. Brief wait to verify port 22000 is closed
        for _ in 0..5 {
            if !Self::is_port_open(22000) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        if Self::is_port_open(22000) {
            log::warn!(
                "[Supervisor] Port 22000 is still responding after backend shutdown attempt."
            );
        } else {
            log::info!("[Supervisor] Node.js backend runtime successfully stopped.");
        }
    }

    /// Stop all managed child processes gracefully
    pub fn stop_all(&mut self) {
        log::info!("[Supervisor] Stopping internal local services...");

        self.stop_backend();

        if let Some(mut child) = self.python_child.take() {
            let pid = child.id();
            log::info!("[Supervisor] Terminating python service (PID: {})...", pid);
            #[cfg(target_os = "windows")]
            {
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
            let _ = child.kill();
            let _ = child.wait();
        }

        #[cfg(target_os = "windows")]
        {
            let python_port_pids = Self::find_pids_by_port(22004);
            for pid in python_port_pids {
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
        }

        log::info!("[Supervisor] Services terminated.");
    }

    /// Orchestrate complete asynchronous startup of all required platform services
    pub fn orchestrate_startup(supervisor_arc: Arc<Mutex<ProcessSupervisor>>, app: AppHandle) {
        std::thread::spawn(move || {
            log::info!("============================================================");
            log::info!("  Compass - Service Supervisor Real-Time Startup Sequence   ");
            log::info!("============================================================");

            let emit_progress = |step: &str, status: &str, msg: &str| {
                if let Ok(mut supervisor) = supervisor_arc.lock() {
                    supervisor.startup_status = StartupStatus {
                        step: step.to_string(),
                        status: status.to_string(),
                        message: msg.to_string(),
                    };
                } else {
                    log::error!("[Supervisor] Could not update startup status.");
                }
                let payload = serde_json::json!({
                    "step": step,
                    "status": status,
                    "message": msg
                });
                let _ = app.emit("startup_step", payload.clone());
                if let Some(splash) = app.get_webview_window("splashscreen") {
                    let _ = splash.emit("startup_step", payload);
                }
            };

            // 1. Ensure storage directories
            emit_progress("storage", "running", "Ensuring storage directories...");
            if let Err(error) = Self::ensure_storage_directories(&app) {
                log::error!("[Supervisor] {error}");
                emit_progress("storage", "error", &error);
                return;
            }
            emit_progress("storage", "completed", "Storage directories verified");

            // 2. Start Python service immediately (local process, does not require Docker)
            emit_progress("python", "running", "Starting Python service (:22004)...");
            let python_start = match supervisor_arc.lock() {
                Ok(mut sup) => sup.start_python_service(&app),
                Err(_) => Err("Could not access the service supervisor.".to_string()),
            };
            if let Err(error) = python_start {
                log::error!("[Supervisor] {error}");
                emit_progress("python", "error", &error);
                return;
            }

            // 3. Trigger Docker startup
            emit_progress("docker", "running", "Verifying Docker daemon...");
            if let Err(error) = Self::start_docker() {
                log::error!("[Supervisor] {error}");
                emit_progress("docker", "error", &error);
                return;
            }

            let app_dir = if let Ok(sup) = supervisor_arc.lock() {
                sup.app_dir.clone()
            } else {
                PathBuf::from(".")
            };

            let mut docker_ready = false;
            let mut compose_launched = false;
            let mut pg_ready = false;
            let mut litellm_ready = false;
            let mut backend_launched = false;
            let mut backend_ready = false;
            let mut py_ready = false;

            let mut prev_docker = false;
            let mut prev_pg = false;
            let mut prev_llm = false;
            let mut prev_py = false;
            let mut prev_backend = false;

            log::info!("[Supervisor] Entering real-time monitoring loop for all 5 services...");

            // Real-time status monitoring loop: runs continuously until ALL 5 required services are online
            // NO arbitrary timeouts or sleep schedules.
            loop {
                // Check Docker
                if !docker_ready {
                    docker_ready = Self::is_docker_running();
                    if docker_ready && !prev_docker {
                        prev_docker = true;
                        log::info!("[Supervisor] Real-time status: Docker daemon is ONLINE");
                        emit_progress("docker", "completed", "Docker daemon is online");
                    }
                }

                // Launch Docker Compose once Docker is confirmed online
                if docker_ready && !compose_launched {
                    emit_progress(
                        "postgres",
                        "running",
                        "Starting PostgreSQL database (:22003)...",
                    );
                    emit_progress("litellm", "running", "Connecting LiteLLM proxy (:22002)...");
                    if let Err(error) = Self::start_docker_compose(&app_dir, &app) {
                        log::error!("[Supervisor] {error}");
                        emit_progress("docker", "error", &error);
                        return;
                    }
                    compose_launched = true;
                }

                // Check PostgreSQL port 22003
                if !pg_ready {
                    if Self::is_port_open(22003) {
                        pg_ready = true;
                        if !prev_pg {
                            prev_pg = true;
                            log::info!(
                                "[Supervisor] Real-time status: PostgreSQL is ONLINE (:22003)"
                            );
                            emit_progress(
                                "postgres",
                                "completed",
                                "PostgreSQL database ready (:22003)",
                            );
                        }
                    }
                }

                // Check LiteLLM port 22002
                if !litellm_ready {
                    if Self::is_litellm_healthy() {
                        litellm_ready = true;
                        if !prev_llm {
                            prev_llm = true;
                            log::info!("[Supervisor] Real-time status: LiteLLM is ONLINE (:22002)");
                            emit_progress(
                                "litellm",
                                "completed",
                                "LiteLLM AI Gateway ready (:22002)",
                            );
                        }
                    }
                }

                // Launch Platform Backend once PostgreSQL is online
                if pg_ready && !backend_launched {
                    emit_progress(
                        "backend",
                        "running",
                        "Starting Platform Core Backend (:22000)...",
                    );
                    let backend_start = match supervisor_arc.lock() {
                        Ok(mut sup) => sup.start_backend(&app, Some(22003), Some(22002)),
                        Err(_) => Err(
                            "Could not access the service supervisor to start the backend."
                                .to_string(),
                        ),
                    };
                    if let Err(error) = backend_start {
                        log::error!("[Supervisor] {error}");
                        emit_progress("backend", "error", &error);
                        return;
                    }
                    backend_launched = true;
                }

                // Check Platform Backend port 22000
                if backend_launched && !backend_ready {
                    if Self::is_backend_healthy() {
                        backend_ready = true;
                        if !prev_backend {
                            prev_backend = true;
                            log::info!("[Supervisor] Real-time status: Backend is ONLINE (:22000)");
                            emit_progress(
                                "backend",
                                "completed",
                                "Platform Core Backend online (:22000)",
                            );
                        }
                    } else {
                        let backend_exit = match supervisor_arc.lock() {
                            Ok(mut sup) => {
                                match sup.backend_child.as_mut().map(Child::try_wait) {
                                    Some(Ok(Some(status))) => {
                                        sup.backend_child = None;
                                        Some(format!("The core Node.js backend exited before becoming healthy ({status}). Check the backend log in the Compass data directory and retry startup."))
                                    }
                                    Some(Err(error)) => Some(format!(
                                        "Could not check the core Node.js backend process state: {error}"
                                    )),
                                    _ => None,
                                }
                            }
                            Err(_) => Some("Could not access the service supervisor while checking the backend.".to_string()),
                        };
                        if let Some(error) = backend_exit {
                            log::error!("[Supervisor] {error}");
                            emit_progress("backend", "error", &error);
                            return;
                        }
                    }
                }

                // Check Python service port 22004
                if !py_ready {
                    if Self::is_python_healthy() {
                        py_ready = true;
                        if !prev_py {
                            prev_py = true;
                            log::info!(
                                "[Supervisor] Real-time status: Python service is ONLINE (:22004)"
                            );
                            emit_progress("python", "completed", "Python service online (:22004)");
                        }
                    } else {
                        let python_exit = match supervisor_arc.lock() {
                            Ok(mut sup) => {
                                match sup.python_child.as_mut().map(Child::try_wait) {
                                    Some(Ok(Some(status))) => {
                                        sup.python_child = None;
                                        Some(format!("The Python service exited before becoming healthy ({status}). Check the Python service log in the Compass data directory and retry startup."))
                                    }
                                    Some(Err(error)) => Some(format!(
                                        "Could not check the Python service process state: {error}"
                                    )),
                                    _ => None,
                                }
                            }
                            Err(_) => Some("Could not access the service supervisor while checking the Python service.".to_string()),
                        };
                        if let Some(error) = python_exit {
                            log::error!("[Supervisor] {error}");
                            emit_progress("python", "error", &error);
                            return;
                        }
                    }
                }

                // Only exit loop when ALL 5 required services are confirmed up and responsive
                if docker_ready && pg_ready && litellm_ready && py_ready && backend_ready {
                    // Final gate: re-verify every service is genuinely healthy right now
                    let all_healthy = Self::is_docker_running()
                        && Self::is_port_open(22003)
                        && Self::is_litellm_healthy()
                        && Self::is_python_healthy()
                        && Self::is_backend_healthy();
                    if !all_healthy {
                        log::warn!(
                            "[Supervisor] Final health verification failed; continuing to wait before revealing the main window."
                        );
                        litellm_ready = litellm_ready && Self::is_litellm_healthy();
                        py_ready = py_ready && Self::is_python_healthy();
                        backend_ready = backend_ready && Self::is_backend_healthy();
                        std::thread::sleep(Duration::from_millis(500));
                        continue;
                    }
                    log::info!("============================================================");
                    log::info!("  ALL 5 PLATFORM SERVICES CONFIRMED ONLINE AND HEALTHY!     ");
                    log::info!("  - Docker Daemon:    ONLINE                                ");
                    log::info!("  - PostgreSQL DB:    ONLINE (:22003)                       ");
                    log::info!("  - LiteLLM Proxy:    ONLINE (:22002)                       ");
                    log::info!("  - Python Service:   ONLINE (:22004)                       ");
                    log::info!("  - Node.js Backend:  ONLINE (:22000)                       ");
                    log::info!("============================================================");
                    break;
                }

                std::thread::sleep(Duration::from_millis(500));
            }

            // ONLY AFTER ALL SERVICES GET STARTED:
            emit_progress(
                "all",
                "completed",
                "All services online! Launching workspace...",
            );

            if let Some(main_window) = app.get_webview_window("main") {
                log::info!(
                    "[Supervisor] Reloading and revealing main window now that all services are fully verified..."
                );
                let _ = main_window.eval("if (typeof window !== 'undefined' && window.location) { window.location.reload(); }");
                std::thread::sleep(Duration::from_millis(300));
                if let Err(e) = main_window.show() {
                    log::error!("[Supervisor] Failed to show main window: {:?}", e);
                }
                let _ = main_window.unminimize();
                let _ = main_window.set_focus();
            }

            if let Some(splash) = app.get_webview_window("splashscreen") {
                log::info!("[Supervisor] Destroying splashscreen cleanly...");
                let _ = splash.hide();
                if let Err(e) = splash.destroy() {
                    log::error!("[Supervisor] Failed to destroy splashscreen: {:?}", e);
                }
            }
        });
    }

    /// Find PIDs listening on a specific local TCP port (Windows netstat parsing)
    pub fn find_pids_by_port(port: u16) -> Vec<u32> {
        let mut pids = Vec::new();
        #[cfg(target_os = "windows")]
        {
            let mut cmd = Command::new("netstat");
            cmd.args(["-ano", "-p", "tcp"]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            if let Ok(output) = cmd.output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let target_port = format!(":{}", port);
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 5 {
                        if parts[1].ends_with(&target_port)
                            && parts[3].eq_ignore_ascii_case("LISTENING")
                        {
                            if let Ok(pid) = parts[4].parse::<u32>() {
                                if pid > 0 && !pids.contains(&pid) {
                                    pids.push(pid);
                                }
                            }
                        }
                    }
                }
            }
        }
        pids
    }

    /// Kill node processes whose binary is located in app resources
    #[cfg(target_os = "windows")]
    pub fn kill_backend_node_processes(app_dir: &Path) {
        let app_dir_clean = app_dir.to_string_lossy().replace('\'', "''");
        let script = format!(
            "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object {{ ($_.Path -and ($_.Path -like '*{app_dir_clean}*')) }} | Stop-Process -Force -ErrorAction SilentlyContinue"
        );
        let mut cmd = Command::new("powershell");
        cmd.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output();
    }
}

pub type SupervisorState = Arc<Mutex<ProcessSupervisor>>;

#[tauri::command]
pub fn get_startup_status(
    state: tauri::State<'_, SupervisorState>,
) -> Result<StartupStatus, String> {
    state
        .lock()
        .map(|supervisor| supervisor.startup_status.clone())
        .map_err(|_| "Could not read Compass startup status.".to_string())
}

#[tauri::command]
pub fn check_services_health() -> ServiceHealthStatus {
    ServiceHealthStatus {
        backend_running: ProcessSupervisor::is_backend_healthy(),
        backend_port: 22000,
        python_running: ProcessSupervisor::is_python_healthy(),
        python_port: 22004,
        docker_running: ProcessSupervisor::is_docker_running(),
        postgres_running: ProcessSupervisor::is_port_open(22003),
        postgres_port: 22003,
        litellm_running: ProcessSupervisor::is_litellm_healthy(),
        litellm_port: 22002,
    }
}

#[tauri::command]
pub fn check_dependencies() -> DependencyStatus {
    let docker_running = ProcessSupervisor::is_docker_running();

    let pg_port = 22003;
    let postgres_running = ProcessSupervisor::is_port_open(pg_port);

    let litellm_port = 22002;
    let litellm_running = ProcessSupervisor::is_port_open(litellm_port);

    let mut node_installed = false;
    let node_candidates = [
        PathBuf::from("node"),
        PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
        PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
    ];
    for cand in &node_candidates {
        let mut node_cmd = Command::new(cand);
        node_cmd.arg("--version");
        #[cfg(target_os = "windows")]
        node_cmd.creation_flags(CREATE_NO_WINDOW);
        if node_cmd
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            node_installed = true;
            break;
        }
    }

    DependencyStatus {
        docker_running,
        postgres_running,
        postgres_port: pg_port,
        litellm_running,
        litellm_port,
        node_installed,
    }
}

#[tauri::command]
pub fn start_all_services(
    app: AppHandle,
    state: tauri::State<'_, SupervisorState>,
) -> Result<String, String> {
    let supervisor_arc = state.inner().clone();
    ProcessSupervisor::orchestrate_startup(supervisor_arc, app);
    Ok("All services startup initiated in background".to_string())
}

#[tauri::command]
pub fn restart_local_services(
    app: AppHandle,
    state: tauri::State<'_, SupervisorState>,
) -> Result<String, String> {
    if let Ok(mut supervisor) = state.lock() {
        supervisor.stop_all();
    }
    std::thread::sleep(Duration::from_millis(800));
    let supervisor_arc = state.inner().clone();
    ProcessSupervisor::orchestrate_startup(supervisor_arc, app);
    Ok("Services restart initiated in background".to_string())
}

#[tauri::command]
pub fn launch_dependency_setup(app: AppHandle) -> Result<String, String> {
    let mut script_path = PathBuf::from("scripts/setup-deps.ps1");
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("scripts/setup-deps.ps1");
        if bundled.exists() {
            script_path = bundled;
        }
    }

    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    let mut cmd = Command::new("powershell");
    cmd.args([
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script_path.to_str().unwrap_or("scripts/setup-deps.ps1"),
        "-InstallDir",
        install_dir.to_str().unwrap_or("."),
    ]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.spawn() {
        Ok(_) => Ok("Dependency setup launched successfully".to_string()),
        Err(e) => Err(format!("Failed to launch dependency setup: {}", e)),
    }
}
