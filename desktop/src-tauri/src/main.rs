//! Native FileNexus shell: tray lifecycle, settings, and single-instance activation.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::error::Error;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreExt;

type DesktopResult<T> = Result<T, Box<dyn Error>>;

/// Log a JavaScript bridge failure with native runtime context.
#[tauri::command]
fn log_desktop_error(detail: String) {
    eprintln!("ERROR FileNexus desktop bridge: {detail}");
    log::error!("FileNexus desktop bridge: {detail}");
}

/// Deliver a native notification and propagate OS delivery errors to the bridge.
#[tauri::command]
fn notify_refresh(app: AppHandle) -> Result<(), String> {
    app.notification()
        .builder()
        .title("FileNexus")
        .body("您的檔案目錄已更新。")
        .show()
        .map_err(|error| format!("Native notification delivery failed: {error}"))
}

/// Log a native failure and show a nonblocking error dialog.
fn report_error(app: &AppHandle, context: &str, error: impl std::fmt::Display) {
    let detail = format!("{context}: {error}");
    eprintln!("ERROR FileNexus desktop: {detail}");
    log::error!("FileNexus desktop: {detail}");
    app.dialog()
        .message(detail)
        .title("FileNexus 錯誤")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

/// Restore the main window and focus it on activation.
fn open_window(app: &AppHandle) -> DesktopResult<()> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main FileNexus window is missing")?;
    window.show()?;
    window.unminimize()?;
    window.set_focus()?;
    Ok(())
}

/// Persist an explicitly selected launch-at-login setting after OS registration.
fn set_autostart(app: &AppHandle, item: &CheckMenuItem<tauri::Wry>) -> DesktopResult<()> {
    let enabled = !item.is_checked()?;
    let manager = app.autolaunch();
    if enabled {
        manager.enable()?;
    } else {
        manager.disable()?;
    }
    let store = app.store("settings.json")?;
    store.set("autostart", serde_json::json!(enabled));
    store.save()?;
    item.set_checked(enabled)?;
    Ok(())
}

/// Build the local window with settings seeded before React and its API service.
fn setup(app: &mut tauri::App) -> DesktopResult<()> {
    let store = app.store("settings.json")?;
    let server_url = match store.get("serverUrl") {
        Some(value) => {
            let origin = value
                .as_str()
                .ok_or("Persisted serverUrl must be a string")?;
            let parsed = tauri::Url::parse(origin)?;
            if !matches!(parsed.scheme(), "http" | "https")
                || parsed.origin().ascii_serialization() != origin
            {
                return Err("Persisted serverUrl must be an HTTP(S) origin".into());
            }
            Some(origin.to_owned())
        }
        None => None,
    };
    let autostart = match store.get("autostart") {
        Some(value) => value
            .as_bool()
            .ok_or("Persisted autostart must be boolean")?,
        None => false,
    };
    let manager = app.autolaunch();
    if autostart != manager.is_enabled()? {
        if autostart {
            manager.enable()?;
        } else {
            manager.disable()?;
        }
    }
    let config = app
        .config()
        .app
        .windows
        .first()
        .ok_or("Main window configuration is missing")?;
    let initialization = format!(
        "window.__FILENEXUS_SERVER_URL__ = {};\n{}",
        serde_json::to_string(&server_url)?,
        include_str!("../../generated/bootstrap.js")
    );
    WebviewWindowBuilder::from_config(app, config)?
        .initialization_script(initialization)
        .build()?;

    let open = MenuItem::with_id(app, "open", "Open FileNexus", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "Check for updates", true, None::<&str>)?;
    let launch = CheckMenuItem::with_id(
        app,
        "autostart",
        "Launch at login",
        true,
        autostart,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", "Server settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &updates, &launch, &settings, &quit])?;
    let icon = app
        .default_window_icon()
        .ok_or("FileNexus tray icon is missing")?
        .clone();
    TrayIconBuilder::with_id("filenexus")
        .icon(icon)
        .tooltip("FileNexus")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| {
            let result: DesktopResult<()> = match event.id.as_ref() {
                "open" => open_window(app),
                "updates" => app.emit("desktop-check-updates", ()).map_err(Into::into),
                "autostart" => set_autostart(app, &launch),
                "settings" => open_window(app)
                    .and_then(|()| app.emit("desktop-settings", ()).map_err(Into::into)),
                "quit" => {
                    app.exit(0);
                    Ok(())
                }
                _ => Err(format!("Unknown tray action: {}", event.id.as_ref()).into()),
            };
            if let Err(error) = result {
                report_error(app, "Tray action failed", error);
            }
        })
        .build(app)?;
    Ok(())
}

/// Run the desktop runtime and report startup failures without panicking.
fn main() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(error) = open_window(app) {
                report_error(app, "Single-instance activation failed", error);
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(MacosLauncher::LaunchAgent)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![log_desktop_error, notify_refresh])
        .setup(|app| {
            if let Err(error) = setup(app) {
                report_error(app.handle(), "Desktop startup failed", &error);
                return Err(error);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    report_error(window.app_handle(), "Failed to hide window to tray", error);
                }
            }
        })
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("ERROR FileNexus runtime failed: {error}");
        std::process::exit(1);
    }
}
