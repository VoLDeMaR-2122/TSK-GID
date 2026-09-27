#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    // Определяем URL в зависимости от режима сборки
    #[cfg(debug_assertions)]
    let url = "http://localhost:3000"; // Режим разработки: грузим локальный сервер

    #[cfg(not(debug_assertions))]
    let url = "https://gid.tsk-community.online"; // Режим продакшена: грузим боевой сайт

    tauri::Builder::default()
        .setup(move |app| {
            let window = app.get_webview_window("main").unwrap();

            // Принудительно загружаем нужный URL
            // Важно: используем eval, чтобы обойти CSP, если он строгий
            let js_code = format!("window.location.href = '{}';", url);
            window.eval(&js_code).ok();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
