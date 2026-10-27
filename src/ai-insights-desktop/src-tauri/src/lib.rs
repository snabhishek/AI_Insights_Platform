mod supervisor;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use supervisor::{
    ProcessSupervisor, SupervisorState, check_dependencies, check_services_health,
    get_startup_status, launch_dependency_setup, restart_local_services, start_all_services,
};
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let supervisor = Arc::new(Mutex::new(ProcessSupervisor::new(app_dir)));
    let supervisor_clone = Arc::clone(&supervisor);
    let supervisor_shutdown = Arc::clone(&supervisor);
    let shutdown_started = Arc::new(AtomicBool::new(false));
    let shutdown_started_window = Arc::clone(&shutdown_started);

    tauri::Builder::default()
        .manage(supervisor as SupervisorState)
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_services_health,
            get_startup_status,
            check_dependencies,
            start_all_services,
            restart_local_services,
            launch_dependency_setup
        ])
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Automatically orchestrate startup of all platform services (Docker, Postgres, LiteLLM, Python, Backend)
            // Keep the main window hidden until the supervisor confirms every service is healthy
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.hide();
            }

            let app_handle = app.handle().clone();
            log::info!(
                "[Tauri] Application starting: launching background service orchestrator..."
            );
            ProcessSupervisor::orchestrate_startup(supervisor_clone, app_handle);

            Ok(())
        })
        .on_window_event(move |window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        log::error!("[Tauri] Could not hide main window during shutdown: {error}");
                    }

                    if shutdown_started_window
                        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                        .is_ok()
                    {
                        log::info!(
                            "[Tauri] Main window closed; stopping services asynchronously..."
                        );
                        let supervisor = Arc::clone(&supervisor_shutdown);
                        let app = window.app_handle().clone();
                        std::thread::spawn(move || {
                            match supervisor.lock() {
                                Ok(mut supervisor) => supervisor.stop_all(),
                                Err(error) => {
                                    log::error!(
                                        "[Tauri] Could not access the service supervisor during shutdown: {error}"
                                    );
                                }
                            }
                            app.exit(0);
                        });
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                log::info!("[Tauri] Application exit event.");
            }
            _ => {}
        });
}
