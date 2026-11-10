use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

// AppMgr 主进程：Rust 侧只做「系统能力」，业务状态仍全在渲染层 store.js。
// 与旧 Electron 版 index.js（621 行 IPC 外壳 + PowerShell/C# 图标链）相比，
// 这里把窗口 / mini / 拖放 / 事件都交给 Tauri JS API，Rust 只保留：
//   ① 数据读写（便携数据目录）② 图标抽取 ③ 启动与定位 ④ 导入队列 ⑤ 托盘。

// ---------------------------------------------------------------- 数据目录

/// Windows 便携版：数据放 exe 同级 data/，解压即用、拷走连同数据一起走。
/// 目录不可写（比如 exe 在只读盘）时静默回退系统 AppData，不让应用起不来。
/// macOS 走 ~/Library/Application Support/com.risomi.appmgr。
fn data_dir(app: &AppHandle) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                let dir = parent.join("data");
                if fs::create_dir_all(&dir).is_ok() {
                    let probe = dir.join(".write-test");
                    if fs::write(&probe, b"ok").is_ok() {
                        let _ = fs::remove_file(&probe);
                        return dir;
                    }
                }
            }
        }
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("appmgr"))
}

fn data_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("app.json"))
}

#[tauri::command]
fn load_data(app: AppHandle) -> Result<Value, String> {
    let path = data_file(&app)?;
    if !path.exists() {
        return Ok(json!({ "version": 1, "categories": [], "items": [] }));
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// 原子写：先写 .tmp 再 rename，避免中途断电/崩溃把 app.json 写半截。
#[tauri::command]
fn save_data(app: AppHandle, data: Value) -> Result<(), String> {
    let path = data_file(&app)?;
    let text = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn dnd_log(message: String) {
    println!("[QL] {}", message);
}

// ---------------------------------------------------------------- 启动 / 定位

fn split_args(s: &str) -> Vec<String> {
    // 支持引号包裹的含空格参数，够覆盖「启动参数」这一档用法
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for ch in s.chars() {
        match ch {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !cur.is_empty() { out.push(std::mem::take(&mut cur)); }
            }
            c => cur.push(c),
        }
    }
    if !cur.is_empty() { out.push(cur); }
    out
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 启动方式判定（纯函数，可单测）。
/// ⚠️ 普通可执行文件一律直接 CreateProcess，**绝不经过 cmd**：
/// cmd.exe 是控制台子系统程序，GUI 应用 spawn 它时 Windows 会新建一个控制台窗口，
/// `start` 一执行完就退出 —— 就是双击项目时那个一闪而逝的黑框。
#[cfg(target_os = "windows")]
#[derive(Debug, PartialEq, Eq)]
enum LaunchKind {
    ShellStart, // 目录 / .lnk / .url：需要 ShellExecute 语义，仍借 cmd start
    Batch,      // .bat / .cmd：控制台脚本，保留可见控制台
    ScriptHost, // .vbs / .vbe / .wsf：wscript.exe
    Direct      // 普通 exe / 带参数：直接 CreateProcess
}

#[cfg(target_os = "windows")]
fn launch_kind(path: &str, is_dir: bool) -> LaunchKind {
    let lower = path.to_ascii_lowercase();
    if is_dir || lower.ends_with(".lnk") || lower.ends_with(".url") {
        LaunchKind::ShellStart
    } else if lower.ends_with(".bat") || lower.ends_with(".cmd") {
        LaunchKind::Batch
    } else if lower.ends_with(".vbs") || lower.ends_with(".vbe") || lower.ends_with(".wsf") {
        LaunchKind::ScriptHost
    } else {
        LaunchKind::Direct
    }
}

#[cfg(target_os = "windows")]
fn spawn_launch(path: &str, args: &str, work_dir: &str, is_dir: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let kind = launch_kind(path, is_dir);
    let mut cmd = match kind {
        LaunchKind::ShellStart => {
            let mut c = Command::new("cmd");
            c.arg("/c").arg("start").arg("").arg(path);
            // cmd 只负责解析 start 后立刻退出，不需要控制台窗口
            c.creation_flags(CREATE_NO_WINDOW);
            c
        }
        LaunchKind::Batch => {
            // 批处理是控制台程序，保留可见控制台：不给它控制台会让内部
            // `for /f` 之类的命令各自 AllocConsole，反而弹出一串黑窗并卡住（旧版踩过）
            let mut c = Command::new("cmd");
            c.arg("/c").arg(path);
            c
        }
        LaunchKind::ScriptHost => {
            let mut c = Command::new("wscript.exe");
            c.arg(path);
            c
        }
        LaunchKind::Direct => Command::new(path),
    };

    if !args.trim().is_empty() && kind != LaunchKind::Batch {
        for a in split_args(args) {
            cmd.arg(a);
        }
    }
    if !work_dir.trim().is_empty() {
        cmd.current_dir(work_dir);
    }

    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) => {
            // 非 PE（脚本文档等）CreateProcess 会失败，降级到 ShellExecute，
            // 同样不新建控制台窗口
            let mut c = Command::new("cmd");
            c.arg("/c").arg("start").arg("").arg(path);
            for a in split_args(args) {
                c.arg(a);
            }
            c.creation_flags(CREATE_NO_WINDOW);
            c.spawn().map_err(|e2| format!("{} / {}", e, e2))?;
            Ok(())
        }
    }
}

#[cfg(target_os = "macos")]
fn spawn_launch(path: &str, args: &str, work_dir: &str, is_dir: bool) -> Result<(), String> {
    use std::process::Command;
    let p = Path::new(path);
    let is_app = path.ends_with(".app") || p.join("Contents").is_dir();
    if is_dir || is_app {
        let mut c = Command::new("open");
        c.arg(path);
        if !args.trim().is_empty() { c.arg("--args"); for a in split_args(args) { c.arg(a); } }
        c.spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let lower = path.to_ascii_lowercase();
    let mut cmd = if lower.ends_with(".sh") || lower.ends_with(".command") {
        let mut c = Command::new("/bin/sh");
        c.arg(path);
        c
    } else if lower.ends_with(".scpt") {
        let mut c = Command::new("osascript");
        c.arg(path);
        c
    } else {
        Command::new(path)
    };
    for a in split_args(args) { cmd.arg(a); }
    if !work_dir.trim().is_empty() { cmd.current_dir(work_dir); }
    match cmd.spawn() {
        Ok(_) => Ok(()),
        Err(e) => {
            let mut c = Command::new("open");
            c.arg(path);
            c.spawn().map_err(|e2| format!("{} / {}", e, e2))?;
            Ok(())
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn spawn_launch(path: &str, args: &str, work_dir: &str, _is_dir: bool) -> Result<(), String> {
    use std::process::Command;
    let mut c = Command::new("xdg-open");
    c.arg(path);
    for a in split_args(args) { c.arg(a); }
    if !work_dir.trim().is_empty() { c.current_dir(work_dir); }
    c.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn launch_item(payload: Value) -> Result<Value, String> {
    let path = payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
    if path.is_empty() { return Ok(json!({ "ok": false, "error": "路径为空" })); }
    let args = payload.get("args").and_then(|v| v.as_str()).unwrap_or("");
    let work_dir = payload.get("workDir").and_then(|v| v.as_str()).unwrap_or("");
    let is_dir = Path::new(path).is_dir()
        || payload.get("type").and_then(|v| v.as_str()) == Some("folder");
    match spawn_launch(path, args, work_dir, is_dir) {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(e) => Ok(json!({ "ok": false, "error": e })),
    }
}

/// Explorer 的 /select, 参数：路径含空格必须整体加引号，否则会从空格处截断，
/// 找不到目标就回退打开系统「文档」库（Lei 真机反馈）。抽成纯函数便于单测。
#[cfg(target_os = "windows")]
fn windows_reveal_arg(normalized: &str, exists: bool) -> String {
    let p = Path::new(normalized);
    if exists {
        format!("/select,\"{}\"", normalized)
    } else if let Some(parent) = p.parent() {
        format!("\"{}\"", parent.display())
    } else {
        format!("/select,\"{}\"", normalized)
    }
}

#[tauri::command]
fn reveal_item(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut c = {
        let normalized = path.replace('/', "\\");
        let mut c = std::process::Command::new("explorer");
        c.arg(windows_reveal_arg(&normalized, Path::new(&normalized).exists()));
        c
    };
    #[cfg(target_os = "macos")]
    let mut c = {
        let mut c = std::process::Command::new("open");
        c.arg("-R").arg(&path);
        c
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut c = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(Path::new(&path).parent().unwrap_or(Path::new(&path)));
        c
    };
    c.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------- 图标抽取

fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        s.push(T[((n >> 18) & 63) as usize] as char);
        s.push(T[((n >> 12) & 63) as usize] as char);
        s.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        s.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    s
}

/// 抽出图标字节 → (mime, bytes)。浏览器原生支持 ICO / PNG 的 data URL，
/// 所以这里不需要任何图像 crate，也不用落盘单独文件。
#[cfg(target_os = "windows")]
fn icon_bytes(path: &str) -> Option<(&'static str, Vec<u8>)> {
    let target = if path.to_ascii_lowercase().ends_with(".lnk") {
        shortcut_target(path).unwrap_or_else(|| path.to_string())
    } else {
        path.to_string()
    };
    pe::extract(&target)
}

#[cfg(target_os = "macos")]
fn icon_bytes(path: &str) -> Option<(&'static str, Vec<u8>)> {
    mac_icon_png(path).map(|png| ("image/png", png))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn icon_bytes(_path: &str) -> Option<(&'static str, Vec<u8>)> {
    None
}

#[tauri::command]
async fn extract_icon(path: String) -> Result<Option<String>, String> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        icon_bytes(&path).map(|(mime, bytes)| format!("data:{};base64,{}", mime, base64(&bytes)))
    }).await.map_err(|e| e.to_string())?;
    Ok(result)
}

/// .lnk 里找目标路径：扫 ASCII 与 UTF-16LE 两种编码里形如 X:\... 的字符串。
/// 不追求完整 Shell Link 解析（那是旧版 437 行 PowerShell 链干的事），
/// 只要能拿到目标给抽图标和启动用即可。
#[cfg(target_os = "windows")]
fn shortcut_target(path: &str) -> Option<String> {
    let b = fs::read(path).ok()?;
    let mut i = 0;
    while i + 3 < b.len() {
        if b[i].is_ascii_alphabetic() && b[i + 1] == b':' && (b[i + 2] == b'\\' || b[i + 2] == b'/') {
            let start = i;
            while i < b.len() && b[i] >= 0x20 && b[i] < 0x7f { i += 1; }
            let s = String::from_utf8_lossy(&b[start..i]).to_string();
            if s.to_ascii_lowercase().ends_with(".exe") { return Some(s); }
            continue;
        }
        i += 1;
    }
    // UTF-16LE：高字节为 0、低字节可打印
    let mut wide = String::new();
    for pair in b.chunks_exact(2) {
        let lo = pair[0];
        if pair[1] == 0 && lo >= 0x20 && lo < 0x7f {
            wide.push(lo as char);
        } else {
            if wide.len() > 4 && wide.to_ascii_lowercase().ends_with(".exe") { return Some(wide); }
            wide.clear();
        }
    }
    None
}

/// macOS：读 .app/Contents/Info.plist 的 CFBundleIconFile → .icns，
/// 用系统自带 sips 转成 PNG（一次短命进程，无第三方 crate）。
#[cfg(target_os = "macos")]
fn mac_icon_png(path: &str) -> Option<Vec<u8>> {
    let app = Path::new(path);
    let plist = fs::read_to_string(app.join("Contents/Info.plist")).ok()?;
    let key = "<key>CFBundleIconFile</key>";
    let pos = plist.find(key)?;
    let rest = &plist[pos + key.len()..];
    let start = rest.find("<string>")? + "<string>".len();
    let end = rest[start..].find("</string>")? + start;
    let mut name = rest[start..end].trim().to_string();
    if !name.contains('.') { name.push_str(".icns"); }
    let icns = app.join("Contents/Resources").join(name);
    if !icns.exists() { return None; }
    let tmp = std::env::temp_dir().join(format!("appmgr-icon-{}.png", std::process::id()));
    let out = std::process::Command::new("sips")
        .arg("-s").arg("format").arg("png")
        .arg(&icns)
        .arg("--out").arg(&tmp)
        .output().ok()?;
    if !out.status.success() { return None; }
    let bytes = fs::read(&tmp).ok()?;
    let _ = fs::remove_file(&tmp);
    Some(bytes)
}

/// Windows：纯 Rust 解析 PE 资源目录，取 RT_GROUP_ICON + RT_ICON，重新拼成 ICO。
/// 旧版靠 PowerShell + C# P/Invoke（409 行 + DLL 缓存），这里零子进程零 DLL。
#[cfg(target_os = "windows")]
mod pe {
    fn u16le(b: &[u8], o: usize) -> Option<u16> {
        Some(u16::from_le_bytes([*b.get(o)?, *b.get(o + 1)?]))
    }
    fn u32le(b: &[u8], o: usize) -> Option<u32> {
        Some(u32::from_le_bytes([*b.get(o)?, *b.get(o + 1)?, *b.get(o + 2)?, *b.get(o + 3)?]))
    }
    struct Sec { va: u32, vs: u32, raw: u32 }
    fn off(secs: &[Sec], rva: u32) -> Option<usize> {
        for s in secs {
            if rva >= s.va && rva < s.va + s.vs {
                return Some((s.raw + (rva - s.va)) as usize);
            }
        }
        None
    }
    /// 资源目录里的 ID 条目（命名条目在前面，NumberOfNamedEntries 之后才是 ID）
    fn entry(b: &[u8], dir_off: usize, want: Option<u32>) -> Option<(u32, u32)> {
        let named = u16le(b, dir_off + 12)? as usize;
        let count = u16le(b, dir_off + 14)? as usize;
        for i in 0..count {
            let p = dir_off + 16 + (named + i) * 8;
            let name = u32le(b, p)?;
            let sub = u32le(b, p + 4)?;
            let id = name & 0x7fff_ffff;
            if name & 0x8000_0000 == 0 && (want.is_none() || Some(id) == want) {
                return Some((id, sub));
            }
        }
        None
    }
    /// IMAGE_RESOURCE_DIR_STRING_U：长度(WORD) + UTF-16LE 字符
    fn res_name(b: &[u8], base: usize, field: u32) -> Option<String> {
        if field & 0x8000_0000 == 0 { return None; }
        let o = base + (field & 0x7fff_ffff) as usize;
        let len = u16le(b, o)? as usize;
        if len > 256 { return None; }
        let mut units = Vec::with_capacity(len);
        for i in 0..len { units.push(u16le(b, o + 2 + i * 2)?); }
        String::from_utf16(&units).ok()
    }
    /// 从「ID 目录 → 语言目录 → IMAGE_RESOURCE_DATA_ENTRY」取真实字节
    fn leaf_data(b: &[u8], secs: &[Sec], base: usize, id_sub: u32) -> Option<Vec<u8>> {
        let id_dir = base + (id_sub & 0x7fff_ffff) as usize;
        let (_, lang_sub) = entry(b, id_dir, None)?;
        let de = base + (lang_sub & 0x7fff_ffff) as usize;
        let rva = u32le(b, de)?;
        let size = u32le(b, de + 4)? as usize;
        let o = off(secs, rva)?;
        Some(b.get(o..o.saturating_add(size))?.to_vec())
    }
    /// 选 RT_GROUP_ICON：⚠️ 优先字符串命名的主图标组（IDR_MAINFRAME 这类）。
    /// 千问 exe 里数字 ID 组全是文件类型关联图标（BT 种子、PDF、视频…），
    /// 只认数字 ID 就会把「BT」文件图标当成 App 图标。
    fn group_data(b: &[u8], secs: &[Sec], base: usize) -> Option<Vec<u8>> {
        let (_, type_sub) = entry(b, base, Some(14))?;
        let type_dir = base + (type_sub & 0x7fff_ffff) as usize;
        let named = u16le(b, type_dir + 12)? as usize;
        for i in 0..named {
            let p = type_dir + 16 + i * 8;
            let name = u32le(b, p)?;
            let gsub = u32le(b, p + 4)?;
            if let Some(n) = res_name(b, base, name) {
                if n.to_ascii_uppercase().contains("MAINFRAME") {
                    if let Some(d) = leaf_data(b, secs, base, gsub) { return Some(d); }
                }
            }
        }
        // 没有命名主图标组时回退到第一个数字 ID 组（大多数普通 exe）
        let (_, id_sub) = entry(b, type_dir, None)?;
        leaf_data(b, secs, base, id_sub)
    }
    /// 按 ID 取 RT_ICON 数据
    fn icon_data(b: &[u8], secs: &[Sec], base: usize, id: u32) -> Option<Vec<u8>> {
        let (_, type_sub) = entry(b, base, Some(3))?;
        let type_dir = base + (type_sub & 0x7fff_ffff) as usize;
        let (_, id_sub) = entry(b, type_dir, Some(id))?;
        leaf_data(b, secs, base, id_sub)
    }
    fn png_size(png: &[u8]) -> Option<(u32, u32)> {
        if png.len() < 24 || &png[0..8] != b"\x89PNG\r\n\x1a\n" { return None; }
        Some((
            u32::from_be_bytes([png[16], png[17], png[18], png[19]]),
            u32::from_be_bytes([png[20], png[21], png[22], png[23]]),
        ))
    }

    /// 返回 (mime, bytes)。⚠️ 优先直接给 PNG、由浏览器缩放，不再拼 ICO：
    /// 豆包 exe 里有标称 256×256 但实际 512×512 的 PNG 条目，拼进 ICO 后
    /// Chromium 按声明尺寸解码会得到空白/透明。直接给 PNG 就没这层陷阱。
    /// 只有完全没有 PNG 条目的老程序才拼 DIB ICO 兜底。
    pub fn extract(path: &str) -> Option<(&'static str, Vec<u8>)> {
        let b = std::fs::read(path).ok()?;
        let pe = u32le(&b, 0x3c)? as usize;
        if b.get(pe..pe + 4)? != b"PE\0\0" { return None; }
        let coff = pe + 4;
        let nsec = u16le(&b, coff + 2)? as usize;
        let opt_size = u16le(&b, coff + 16)? as usize;
        let opt = coff + 20;
        let magic = u16le(&b, opt)?;
        let dd = opt + if magic == 0x20b { 112 } else { 96 };
        let rsrc_rva = u32le(&b, dd + 2 * 8)?;
        let mut secs = Vec::new();
        for i in 0..nsec {
            let s = opt + opt_size + i * 40;
            secs.push(Sec {
                va: u32le(&b, s + 12)?,
                vs: u32le(&b, s + 8)?,
                raw: u32le(&b, s + 20)?,
            });
        }
        let base = off(&secs, rsrc_rva)?;
        let group = group_data(&b, &secs, base)?;
        let count = u16le(&group, 4)? as usize;
        if count == 0 || count > 64 { return None; }

        let mut best: Option<(u64, Vec<u8>)> = None;
        let mut dibs: Vec<(Vec<u8>, u8, u8)> = Vec::new();
        for i in 0..count {
            let p = 6 + i * 14;
            if p + 14 > group.len() { continue; }
            let id = u16le(&group, p + 12)? as u32;
            let Some(bytes) = icon_data(&b, &secs, base, id) else { continue };
            if let Some((w, h)) = png_size(&bytes) {
                // 直接返回 PNG 由浏览器缩放，不受 ICO 的 256 上限约束；
                // 挑面积最大的：同一图标的大图通常更干净，小图常带调色板抖动
                let score = (w * h) as u64;
                if best.as_ref().map_or(true, |(s, _)| score > *s) {
                    best = Some((score, bytes));
                }
            } else if bytes.len() > 40 {
                let w = u32le(&bytes, 4).unwrap_or(0) as u8;
                let h = (u32le(&bytes, 8).unwrap_or(0) / 2) as u8;
                dibs.push((bytes, w, h));
            }
        }
        if let Some((_, png)) = best { return Some(("image/png", png)); }
        if dibs.is_empty() { return None; }

        let n = dibs.len();
        let mut ico = vec![0u8, 0, 1, 0, n as u8, 0];
        let mut cursor = 6 + n * 16;
        for (blob, w, h) in &dibs {
            ico.extend_from_slice(&[*w, *h, 0, 0]);
            ico.extend_from_slice(&1u16.to_le_bytes()); // planes
            ico.extend_from_slice(&32u16.to_le_bytes()); // bitCount
            ico.extend_from_slice(&(blob.len() as u32).to_le_bytes());
            ico.extend_from_slice(&(cursor as u32).to_le_bytes());
            cursor += blob.len();
        }
        for (blob, _, _) in &dibs { ico.extend_from_slice(blob); }
        Some(("image/x-icon", ico))
    }
}

// ---------------------------------------------------------------- 拖入导入

fn display_name(path: &str) -> String {
    let p = Path::new(path);
    let raw = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let lower = raw.to_ascii_lowercase();
    for ext in [".app", ".exe", ".lnk", ".bat", ".cmd", ".url", ".appref-ms", ".command", ".sh", ".scpt"] {
        if lower.ends_with(ext) { return raw[..raw.len() - ext.len()].to_string(); }
    }
    raw
}

#[tauri::command]
async fn import_files(app: AppHandle, paths: Vec<String>, category_id: String) -> Result<(), String> {
    let total = paths.len();
    if total == 0 { return Ok(()); }
    let mut items = Vec::new();
    let mut skipped = 0usize;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();

    for (i, path) in paths.iter().enumerate() {
        let name = display_name(path);
        let _ = app.emit("items-progress", json!({
            "done": i, "total": total, "name": name, "phase": "extract"
        }));
        let meta = fs::metadata(path);
        if meta.is_err() { skipped += 1; continue; }
        let is_dir = meta.map(|m| m.is_dir()).unwrap_or(false);
        let icon = tauri::async_runtime::spawn_blocking({
            let p = path.clone();
            move || icon_bytes(&p).map(|(mime, bytes)| format!("data:{};base64,{}", mime, base64(&bytes)))
        }).await.map_err(|e| e.to_string())?;
        items.push(json!({
            "id": format!("item_{}_{}", stamp, i),
            "name": name,
            "path": path,
            "type": if is_dir { "folder" } else { "app" },
            "categoryId": category_id,
            "args": "",
            "workDir": "",
            "logo": icon,
            "order": i
        }));
    }
    let _ = app.emit("items-progress", json!({ "done": total, "total": total, "phase": "finished" }));
    let _ = app.emit("items-added", json!({ "items": items, "skipped": skipped }));
    Ok(())
}

// ---------------------------------------------------------------- 托盘 / 关闭

/// 把隐藏的主窗口重新显示并聚焦。
/// ⚠️ macOS 上必须先 `AppHandle::show()` 把整个应用 unhide：点 Dock 图标时
/// NSApplication 可能仍处于 hidden 状态，只 show 窗口是看不见的。
/// 托盘「显示窗口」、托盘左键、Dock 点开三条路径共用这一处。
fn show_main_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            setup_tray(app.handle())?;
            Ok(())
        })
        // 关闭 = 收进后台：窗口 hide 但进程继续跑，托盘 / 菜单栏可唤回。
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            dnd_log,
            launch_item,
            reveal_item,
            extract_icon,
            import_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // ⚠️ macOS：点 Dock 图标会触发 applicationShouldHandleReopen（RunEvent::Reopen）。
    // 之前只 hide() 没接这个事件 —— 关窗后进程还活着、Dock 点了却没任何反应
    // （Windows 有托盘双击兜底，这条路径在 mac 上一直是空的）。
    // Reopen 与 AppHandle::show 都是 macOS-only 编译项，必须包 cfg，否则 Windows 编译失败。
    app.run(|handle, event| {
        let _ = &handle;
        match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => show_main_window(handle),
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_roundtrip_shape() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn pe_icon_from_real_system_exe() {
        // 真夹具：从系统 exe 的 PE 资源里抽 ICO，验证整条目录解析链不是纸上谈兵
        let candidates = [
            r"C:\Windows\System32\cmd.exe",
            r"C:\Windows\explorer.exe",
            r"C:\Windows\System32\regedit.exe",
        ];
        let mut got = false;
        for path in candidates {
            if let Some((mime, bytes)) = super::pe::extract(path) {
                assert!(bytes.len() > 22, "图标太短");
                if mime == "image/png" {
                    assert_eq!(&bytes[0..8], b"\x89PNG\r\n\x1a\n", "PNG 头不对");
                } else {
                    assert_eq!(mime, "image/x-icon");
                    assert_eq!(&bytes[0..4], &[0, 0, 1, 0], "ICONDIR 头不对");
                }
                got = true;
                break;
            }
        }
        assert!(got, "没有任何系统 exe 抽出了图标");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_launch_plan_avoids_cmd_for_normal_exe() {
        // 主诉回归：普通 exe 不能再落到 cmd /c start（会闪控制台窗口）
        assert_eq!(launch_kind(r"C:\Apps\Foo.exe", false), LaunchKind::Direct);
        assert_eq!(launch_kind(r"C:\Apps\notes.txt", false), LaunchKind::Direct);
        assert_eq!(launch_kind(r"C:\Apps\Foo.lnk", false), LaunchKind::ShellStart);
        assert_eq!(launch_kind(r"C:\Apps\Foo.url", false), LaunchKind::ShellStart);
        assert_eq!(launch_kind(r"C:\Apps\Foo.exe", true), LaunchKind::ShellStart);
        assert_eq!(launch_kind(r"C:\Apps\run.bat", false), LaunchKind::Batch);
        assert_eq!(launch_kind(r"C:\Apps\run.cmd", false), LaunchKind::Batch);
        assert_eq!(launch_kind(r"C:\Apps\run.vbs", false), LaunchKind::ScriptHost);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn pe_icons_for_doubao_and_qianwen() {
        // 真机回归：豆包透明 / 千问 BT 图标。CI 上没有这两个 exe 时自动跳过。
        let doubao = r"D:\Program Files\Doubao\Doubao.exe";
        let qianwen = r"D:\Program Files\QianwenApp\qianwen.exe";
        if !std::path::Path::new(doubao).exists() || !std::path::Path::new(qianwen).exists() {
            return;
        }
        let (m1, b1) = super::pe::extract(doubao).expect("豆包应抽出图标");
        assert_eq!(m1, "image/png");
        assert_eq!(&b1[0..8], b"\x89PNG\r\n\x1a\n");
        let w1 = u32::from_be_bytes([b1[16], b1[17], b1[18], b1[19]]);
        assert!(w1 >= 256, "豆包应拿到干净大图，实际 {}", w1);
        let _ = std::fs::write(r"C:\Users\milay\AppData\Local\Temp\appmgr-doubao-selected.png", &b1);

        let (m2, b2) = super::pe::extract(qianwen).expect("千问应抽出图标");
        assert_eq!(m2, "image/png");
        assert_eq!(&b2[0..8], b"\x89PNG\r\n\x1a\n");
        // 落在命名主图标组里即可（该组同时有 768 与 256 两档，优先 <=256）。
        // 导出图片供人工核对不是 BT 文件图标，比硬编码字节长度可靠。
        let _ = std::fs::write(r"C:\Users\milay\AppData\Local\Temp\appmgr-qianwen-selected.png", &b2);
        assert!(b2.len() > 1000, "千问图标数据异常");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn reveal_arg_quotes_paths_with_spaces() {
        assert_eq!(
            super::windows_reveal_arg(r"D:\Program Files\Doubao\Doubao.exe", true),
            r#"/select,"D:\Program Files\Doubao\Doubao.exe""#
        );
        assert_eq!(
            super::windows_reveal_arg(r"D:\Program Files\Doubao\missing.exe", false),
            r#""D:\Program Files\Doubao""#
        );
    }

    #[test]
    fn split_args_handles_quotes() {
        assert_eq!(split_args(r#"--name "a b" -x"#), vec!["--name", "a b", "-x"]);
    }

    #[test]
    fn display_name_strips_platform_extensions() {
        assert_eq!(display_name(r"C:\Apps\Foo.exe"), "Foo");
        assert_eq!(display_name("/Applications/Bar.app"), "Bar");
        assert_eq!(display_name("/Users/me/docs"), "docs");
    }
}
