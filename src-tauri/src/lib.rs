use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg(target_os = "macos")]
fn position_traffic_lights(window: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let Ok(handle) = window.window_handle() else {
        return;
    };

    if let RawWindowHandle::AppKit(appkit) = handle.as_raw() {
        use objc::msg_send;
        use objc::sel;
        use objc::sel_impl;

        #[repr(C)]
        struct NSPoint {
            x: f64,
            y: f64,
        }

        #[repr(C)]
        struct NSSize {
            width: f64,
            height: f64,
        }

        #[repr(C)]
        struct NSRect {
            origin: NSPoint,
            size: NSSize,
        }

        let ns_view = appkit.ns_view.as_ptr() as *mut objc::runtime::Object;

        unsafe {
            let ns_window: *mut objc::runtime::Object = msg_send![ns_view, window];

            let close: *mut objc::runtime::Object =
                msg_send![ns_window, standardWindowButton: 0i64];
            let minimize: *mut objc::runtime::Object =
                msg_send![ns_window, standardWindowButton: 1i64];
            let zoom: *mut objc::runtime::Object =
                msg_send![ns_window, standardWindowButton: 2i64];

            // Offset from default position (safer than absolute coordinates)
            let dx: f64 = 4.0;
            let dy: f64 = 10.0;

            let close_frame: NSRect = msg_send![close, frame];
            let _: () = msg_send![close, setFrameOrigin: NSPoint {
                x: close_frame.origin.x + dx,
                y: close_frame.origin.y + dy,
            }];

            let min_frame: NSRect = msg_send![minimize, frame];
            let _: () = msg_send![minimize, setFrameOrigin: NSPoint {
                x: min_frame.origin.x + dx,
                y: min_frame.origin.y + dy,
            }];

            let zoom_frame: NSRect = msg_send![zoom, frame];
            let _: () = msg_send![zoom, setFrameOrigin: NSPoint {
                x: zoom_frame.origin.x + dx,
                y: zoom_frame.origin.y + dy,
            }];
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    position_traffic_lights(&window);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
