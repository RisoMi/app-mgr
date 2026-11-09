use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewWindow};

// 阶段 0：Rust 侧只保留三类系统能力 —— 数据读写、启动、窗口。
// 旧 Electron 版 index.js 有 621 行 IPC 外壳，这里刻薄地收成下面几个命令；
// 图标抽取 / 快捷方式解析 / 托盘等按阶段补，且一律走 cfg(target_os) 分流，
// 不再有 PowerShell + C# DLL 这类 Windows 专属链。

fn data_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("app.json"))
}

#[tauri::command]
fn ping() -> String {
    "pong".to_string()
}

#[tauri::command]
fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

/// 空数据目录时返回与旧版一致的最小结构，便于 A 档 store.js 直接复用。
#[tauri::command]
fn load_data(app: AppHandle) -> Result<Value, String> {
    let path = data_file(&app)?;
    if !path.exists() {
        return Ok(serde_json::json!({ "version": 1, "categories": [], "items": [] }));
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// 渲染层仍是唯一写盘方：Rust 只负责把整份 JSON 原子性地落盘。
#[tauri::command]
fn save_data(app: AppHandle, data: Value) -> Result<(), String> {
    let path = data_file(&app)?;
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

/// 无参数启动。Windows 用 cmd /c start（等价双击），macOS 用 open（.app / 目录都认）。
/// 带参数 / 工作目录 / 脚本宿主等语义在阶段 2 按平台补齐。
#[tauri::command]
fn launch_item(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = std::process::Command::new("cmd");
        c.args(["/c", "start", "", path.as_str()]);
        c
    };

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(path.as_str());
        c
    };

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(path.as_str());
        c
    };

    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            ping,
            get_platform,
            load_data,
            save_data,
            launch_item,
            set_always_on_top
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
