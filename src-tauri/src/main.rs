#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    // Определяем целевой URL
    #[cfg(debug_assertions)]
    let url = "http://localhost:3000"; // Для разработки

    #[cfg(not(debug_assertions))]
    let url = "https://gid.tsk-community.online"; // Для продакшена

    tauri::Builder::default()
        .setup(move |app| {
            // Создаем главное окно
            let window = app.get_webview_window("main").unwrap();

            // Загружаем внешний URL вместо локальных файлов
            // Это позволяет использовать твою авторизацию Discord, WS и БД без переноса кода в Rust
            window
                .eval(&format!("window.location.href = '{}';", url))
                .ok();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
