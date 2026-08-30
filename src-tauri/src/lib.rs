use std::fs;
use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const OPENCODE_PORT: &str = "2138";
const OPENCODE_URL: &str = "http://localhost:2138";

static SERVER_PID: Mutex<Option<u32>> = Mutex::new(None);

// ─── Structs ──────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub display_path: String,
}

#[derive(Serialize)]
pub struct OpenCodeStatus {
    pub installed: bool,
    pub serving: bool,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SessionMetadata {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub directory: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ScaffoldPayload {
    pub kind: String,
    pub data: String,
}

// camelCase on the wire: Tauri converts command *arguments* from JS camelCase
// automatically, but *return values* are serialized as-is — the frontend
// (src/lib/http-fetch.ts) reads statusText/contentType.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchResponse {
    pub status: u16,
    pub status_text: String,
    pub content_type: String,
    pub body: String,
}

// ─── Path helpers ─────────────────────────────────────────────────────────

fn make_display_path(path: &PathBuf) -> String {
    if let Some(home) = dirs::home_dir() {
        if let Ok(rel) = path.strip_prefix(&home) {
            return format!("~/{}", rel.to_string_lossy());
        }
    }
    path.to_string_lossy().to_string()
}

fn chat_ui_base_dir() -> Result<PathBuf, String> {
    let doc_dir = dirs::document_dir()
        .ok_or_else(|| "Could not find Documents directory".to_string())?;
    Ok(doc_dir.join("chatUI"))
}

fn sessions_dir() -> Result<PathBuf, String> {
    Ok(chat_ui_base_dir()?.join("sessions"))
}

fn projects_dir() -> Result<PathBuf, String> {
    Ok(chat_ui_base_dir()?.join("projects"))
}

// ─── Directory management ─────────────────────────────────────────────────

#[tauri::command]
fn ensure_chat_ui_directory() -> Result<String, String> {
    let base = chat_ui_base_dir()?;
    if !base.exists() {
        fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    }
    for sub in &["sessions", "agents", "projects", "skills", "mcp", "logs"] {
        let dir = base.join(sub);
        if !dir.exists() {
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        }
    }
    let settings = base.join("settings.json");
    if !settings.exists() {
        fs::write(&settings, "{}").map_err(|e| e.to_string())?;
    }
    Ok(base.to_string_lossy().to_string())
}

#[tauri::command]
fn create_project_directory(name: &str) -> Result<DirEntry, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }
    let base = projects_dir()?;
    if !base.exists() {
        fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    }
    let project_path = base.join(trimmed);
    if project_path.exists() {
        return Err(format!("A project named '{}' already exists", trimmed));
    }
    fs::create_dir(&project_path).map_err(|e| e.to_string())?;
    Ok(DirEntry {
        name: trimmed.to_string(),
        path: project_path.to_string_lossy().to_string(),
        display_path: make_display_path(&project_path),
    })
}

#[tauri::command]
fn list_project_directories() -> Result<Vec<DirEntry>, String> {
    let base = projects_dir()?;
    if !base.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    if let Ok(read) = fs::read_dir(&base) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('.') {
                    entries.push(DirEntry {
                        name,
                        path: path.to_string_lossy().to_string(),
                        display_path: make_display_path(&path),
                    });
                }
            }
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
fn delete_project_directory(path: &str) -> Result<(), String> {
    let target = PathBuf::from(path);
    let base = projects_dir()?;
    if !target.starts_with(&base) {
        return Err("Cannot delete directories outside of chatUI projects".to_string());
    }
    if !target.exists() {
        return Err("Directory does not exist".to_string());
    }
    fs::remove_dir_all(&target).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_existing_directory(path: &str) -> Result<DirEntry, String> {
    let target = PathBuf::from(path);
    if !target.exists() {
        return Err("Directory does not exist".to_string());
    }
    if !target.is_dir() {
        return Err("Path is not a directory".to_string());
    }
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unnamed".to_string());
    Ok(DirEntry {
        name,
        path: target.to_string_lossy().to_string(),
        display_path: make_display_path(&target),
    })
}

#[tauri::command]
fn create_subdirectory(parent_path: &str, name: &str) -> Result<DirEntry, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Sub-project name cannot be empty".to_string());
    }
    let parent = PathBuf::from(parent_path);
    if !parent.exists() || !parent.is_dir() {
        return Err("Parent directory does not exist".to_string());
    }
    let sub_path = parent.join(trimmed);
    if sub_path.exists() {
        return Err(format!("A sub-project named '{}' already exists", trimmed));
    }
    fs::create_dir(&sub_path).map_err(|e| e.to_string())?;
    Ok(DirEntry {
        name: trimmed.to_string(),
        path: sub_path.to_string_lossy().to_string(),
        display_path: make_display_path(&sub_path),
    })
}

#[tauri::command]
fn list_subdirectories(parent_path: &str) -> Result<Vec<DirEntry>, String> {
    let parent = PathBuf::from(parent_path);
    if !parent.exists() || !parent.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    if let Ok(read) = fs::read_dir(&parent) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('.') {
                    entries.push(DirEntry {
                        name,
                        path: path.to_string_lossy().to_string(),
                        display_path: make_display_path(&path),
                    });
                }
            }
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

// ─── Generic file helpers (scoped to user-chosen / app dirs) ──────────────

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    PathBuf::from(&path).exists()
}

#[tauri::command]
fn remove_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else if p.is_file() {
        fs::remove_file(&p).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn list_dir_entries(path: String) -> Result<Vec<DirEntry>, String> {
    let p = PathBuf::from(&path);
    if !p.exists() || !p.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    if let Ok(read) = fs::read_dir(&p) {
        for entry in read.flatten() {
            let ep = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            entries.push(DirEntry {
                name,
                path: ep.to_string_lossy().to_string(),
                display_path: make_display_path(&ep),
            });
        }
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not find home directory".to_string())
}

#[tauri::command]
fn get_opencode_config_path(directory: Option<String>) -> Result<String, String> {
    match directory {
        Some(d) if !d.trim().is_empty() => {
            Ok(PathBuf::from(d).join("opencode.json").to_string_lossy().to_string())
        }
        _ => {
            let home = dirs::home_dir().ok_or_else(|| "Could not find home directory".to_string())?;
            Ok(home
                .join(".config")
                .join("opencode")
                .join("opencode.json")
                .to_string_lossy()
                .to_string())
        }
    }
}

// ─── OpenCode helpers ─────────────────────────────────────────────────────

fn opencode_bin() -> String {
    // Prefer the opencode installed in ~/.opencode/bin, fall back to PATH.
    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(".opencode").join("bin").join("opencode");
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }
    "opencode".to_string()
}

fn opencode_exists() -> bool {
    PathBuf::from(opencode_bin()).exists() || Command::new("which").arg("opencode").output().map(|o| o.status.success()).unwrap_or(false)
}

fn opencode_health() -> bool {
    let url = format!("{}/global/health", OPENCODE_URL);
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .ok()
        .and_then(|client| client.get(&url).send().ok())
        .map(|resp| resp.status().is_success())
        .unwrap_or(false)
}

fn kill_tracked_server() {
    if let Some(pid) = *SERVER_PID.lock().unwrap() {
        let _ = Command::new("kill").arg("-9").arg(pid.to_string()).output();
        *SERVER_PID.lock().unwrap() = None;
    }
}

/// Find the PID of the process listening on `port` (if any).
fn pid_listening_on(port: &str) -> Option<u32> {
    let out = Command::new("lsof")
        .args(["-t", "-nP", &format!("-iTCP:{}", port), "-sTCP:LISTEN"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.trim().parse::<u32>().ok())
        .next()
}

/// Adopt an already-running server on our port so quitting the app stops it.
/// Idempotent: never overwrites a PID we already track.
fn adopt_server_if_needed() {
    if SERVER_PID.lock().unwrap().is_none() {
        if let Some(pid) = pid_listening_on(OPENCODE_PORT) {
            *SERVER_PID.lock().unwrap() = Some(pid);
        }
    }
}

fn server_log_path() -> Option<PathBuf> {
    chat_ui_base_dir().ok().map(|b| b.join("logs").join("opencode-server.log"))
}

fn spawn_opencode_server(dir: Option<&str>) -> Result<(), String> {
    kill_tracked_server();
    // Evict any untracked, non-responsive squatter on our port (e.g. a stale
    // password-protected server from before env sanitization) so the fresh
    // spawn can bind. kill -9 on an already-dead PID is a harmless no-op.
    if let Some(pid) = pid_listening_on(OPENCODE_PORT) {
        let _ = Command::new("kill").arg("-9").arg(pid.to_string()).output();
    }
    std::thread::sleep(Duration::from_millis(300));

    let bin = opencode_bin();
    let mut cmd = Command::new(&bin);
    // Never inherit an opencode/OpenChamber session environment. A leaked
    // OPENCODE_SERVER_PASSWORD makes the spawned server demand Basic auth on
    // every endpoint — including /global/health — so the health check fails
    // with 401 and the app reports "OpenCode server is not running".
    // OPENCODE_CONFIG_CONTENT would also pull OpenChamber's plugin into our
    // server. env_remove is a no-op when the variable is not set.
    for key in [
        "OPENCODE",
        "OPENCODE_PID",
        "OPENCODE_BINARY",
        "OPENCODE_SERVER_PASSWORD",
        "OPENCODE_CONFIG_CONTENT",
        "OPENCHAMBER_OPENCODE_CWD",
    ] {
        cmd.env_remove(key);
    }
    // Pin the port so the frontend (http://localhost:2138) and health check match.
    // Include CORS for dev (localhost:1420), Windows/Linux prod (tauri.localhost),
    // and macOS prod (tauri://localhost).
    cmd.args([
        "serve",
        "--port",
        OPENCODE_PORT,
        "--hostname",
        "127.0.0.1",
        "--cors",
        "http://localhost:1420",
        "--cors",
        "http://tauri.localhost",
        "--cors",
        "tauri://localhost",
    ]);

    // Capture stderr to a log file so failures are diagnosable (was Stdio::null()).
    let log_path = server_log_path();
    let stderr: Stdio = if let Some(ref log) = log_path {
        if let Some(parent) = log.parent() {
            let _ = fs::create_dir_all(parent);
        }
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)
            .map(|f| Stdio::from(f))
            .unwrap_or_else(|_| Stdio::null())
    } else {
        Stdio::null()
    };
    cmd.stdout(Stdio::null());
    cmd.stderr(stderr);

    if let Some(d) = dir {
        let path = PathBuf::from(d);
        if !path.exists() {
            return Err(format!("Directory does not exist: {}", d));
        }
        if !path.is_dir() {
            return Err(format!("Path is not a directory: {}", d));
        }
        cmd.current_dir(&path);
    }
    let child = cmd.spawn().map_err(|e| format!("Failed to start opencode serve: {}", e))?;
    *SERVER_PID.lock().unwrap() = Some(child.id());
    // Detach: dropping the Child does not kill it in std.
    drop(child);
    Ok(())
}

// ─── Tauri commands: OpenCode lifecycle ───────────────────────────────────

#[tauri::command]
async fn opencode_status() -> Result<OpenCodeStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let installed = opencode_exists();
        let serving = installed && opencode_health();
        // If a server is already running on our port, adopt it so quitting
        // the app stops it cleanly. Runs on every status check but is
        // idempotent (never overwrites a tracked PID).
        if serving {
            adopt_server_if_needed();
        }
        Ok(OpenCodeStatus {
            installed,
            serving,
            url: OPENCODE_URL.to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn opencode_install() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = Command::new("sh")
            .arg("-c")
            .arg("curl -fsSL https://opencode.ai/install | bash")
            .output()
            .map_err(|e| format!("Failed to run install: {}", e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Install failed: {}", stderr.trim()));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn opencode_serve_start() -> Result<(), String> {
    // Everything runs inside spawn_blocking: opencode_health() uses reqwest's
    // blocking client, which must NOT be called on an async runtime thread
    // (it panics/stalls there, the IPC response is never sent, and the
    // frontend hangs on "Starting OpenCode server…" forever).
    tauri::async_runtime::spawn_blocking(|| {
        if !opencode_exists() {
            return Err("OpenCode is not installed".to_string());
        }
        if opencode_health() {
            // Adopt an already-running server on our port (e.g. left over from
            // a previous app instance) so quitting the app stops it cleanly.
            adopt_server_if_needed();
            return Ok(());
        }
        ensure_chat_ui_directory()?;
        let base = chat_ui_base_dir()?;
        let dir = base.to_string_lossy().to_string();
        spawn_opencode_server(Some(&dir))?;
        wait_for_health_blocking()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn opencode_serve_stop() -> Result<(), String> {
    kill_tracked_server();
    Ok(())
}

#[tauri::command]
fn opencode_server_log() -> Result<String, String> {
    match server_log_path() {
        Some(p) if p.exists() => fs::read_to_string(&p).map_err(|e| e.to_string()),
        _ => Ok(String::new()),
    }
}

#[tauri::command]
async fn opencode_serve_in_dir(dir: Option<String>) -> Result<(), String> {
    if !opencode_exists() {
        return Err("OpenCode is not installed".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        spawn_opencode_server(dir.as_deref())?;
        wait_for_health_blocking()
    })
    .await
    .map_err(|e| e.to_string())?
}

fn wait_for_health_blocking() -> Result<(), String> {
    let start = std::time::Instant::now();
    while start.elapsed().as_secs() < 30 {
        if opencode_health() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    Err("OpenCode server did not start within 30 seconds".to_string())
}

// ─── MCP auth ──────────────────────────────────────────────────────────────

#[tauri::command]
async fn opencode_mcp_auth(name: String) -> Result<(), String> {
    let bin = opencode_bin();
    // Spawn detached — opencode opens a browser for the OAuth flow.
    Command::new(&bin)
        .args(["mcp", "auth", &name])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to run opencode mcp auth: {}", e))?;
    Ok(())
}

// ─── Web fetch (CORS-free) ─────────────────────────────────────────────────

/// Fetch an arbitrary URL from the Rust side. The webview's own fetch() is
/// subject to CORS, and most websites (and DuckDuckGo's HTML search) don't
/// send Access-Control-Allow-Origin, so web_fetch / Deep Research fetching
/// goes through here instead. A real browser User-Agent is required —
/// DuckDuckGo 403s bot-like UAs.
#[tauri::command]
async fn http_fetch(url: String, timeout_ms: Option<u64>) -> Result<HttpFetchResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(timeout_ms.unwrap_or(15000)))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client
            .get(&url)
            .header(
                reqwest::header::USER_AGENT,
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
            )
            .header(reqwest::header::ACCEPT, "text/html, text/plain, */*")
            .send()
            .map_err(|e| e.to_string())?;

        let status = resp.status().as_u16();
        let status_text = resp.status().canonical_reason().unwrap_or("").to_string();
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body = resp.text().unwrap_or_default();
        // Bound the payload crossing IPC; callers truncate further themselves.
        let body: String = body.chars().take(500_000).collect();

        Ok(HttpFetchResponse { status, status_text, content_type, body })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── Python execution ──────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonRunResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

/// Run a Python snippet with the system python3 (used by the agent's
/// run_python tool and the artifact panel's Run button). The code is written
/// to a temp file and the child is polled with try_wait; on timeout it is
/// killed so a runaway script cannot hang the IPC call. stdout/stderr are
/// drained on separate threads so a full pipe buffer can't deadlock the child.
#[tauri::command]
async fn run_python(code: String, timeout_ms: Option<u64>) -> Result<PythonRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;

        let timeout = Duration::from_millis(timeout_ms.unwrap_or(30000));

        let script_path = std::env::temp_dir().join(format!(
            "chatui-python-{}-{}.py",
            std::process::id(),
            now_unix()
        ));
        fs::write(&script_path, &code)
            .map_err(|e| format!("Failed to write temp script: {}", e))?;

        let mut child = Command::new("python3")
            .arg(&script_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                let _ = fs::remove_file(&script_path);
                format!("Failed to start python3: {}", e)
            })?;

        let stdout_handle = child.stdout.take().map(|mut out| {
            std::thread::spawn(move || {
                let mut s = String::new();
                let _ = out.read_to_string(&mut s);
                s
            })
        });
        let stderr_handle = child.stderr.take().map(|mut err| {
            std::thread::spawn(move || {
                let mut s = String::new();
                let _ = err.read_to_string(&mut s);
                s
            })
        });

        let start = std::time::Instant::now();
        let mut timed_out = false;
        let mut final_status: Option<std::process::ExitStatus> = None;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    final_status = Some(status);
                    break;
                }
                Ok(None) => {
                    if start.elapsed() >= timeout {
                        timed_out = true;
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => {
                    let _ = fs::remove_file(&script_path);
                    return Err(format!("Failed to wait on python3: {}", e));
                }
            }
        }

        let stdout = stdout_handle
            .and_then(|h| h.join().ok())
            .unwrap_or_default();
        let stderr = stderr_handle
            .and_then(|h| h.join().ok())
            .unwrap_or_default();

        let exit_code = final_status.and_then(|s| s.code()).unwrap_or(-1);

        let _ = fs::remove_file(&script_path);

        // Bound the payloads crossing IPC.
        let stdout: String = stdout.chars().take(200_000).collect();
        let stderr: String = stderr.chars().take(200_000).collect();

        Ok(PythonRunResult { stdout, stderr, exit_code, timed_out })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── Scaffolding ───────────────────────────────────────────────────────────

fn scaffold_command(template: &str) -> Result<(String, Vec<String>), String> {
    match template {
        "nextjs" | "cloudflare-opennext" => Ok((
            "npx".to_string(),
            vec![
                "--yes".to_string(),
                "create-next-app@latest".to_string(),
                ".".to_string(),
                "--ts".to_string(),
                "--tailwind".to_string(),
                "--eslint".to_string(),
                "--app".to_string(),
                "--no-src-dir".to_string(),
                "--import-alias".to_string(),
                "@/*".to_string(),
                "--use-npm".to_string(),
            ],
        )),
        "fastapi" => Ok((
            "sh".to_string(),
            vec![
                "-c".to_string(),
                "uv init --bare 2>/dev/null || python3 -m venv .venv; uv add fastapi uvicorn 2>/dev/null || true".to_string(),
            ],
        )),
        "python" => Ok((
            "sh".to_string(),
            vec!["-c".to_string(), "uv init --bare 2>/dev/null || python3 -m venv .venv".to_string()],
        )),
        "nodejs" => Ok(("npm".to_string(), vec!["init".to_string(), "-y".to_string()])),
        _ => Err(format!("No scaffold command for template '{}'", template)),
    }
}

#[tauri::command]
async fn run_scaffold(app: tauri::AppHandle, directory: String, template: String) -> Result<(), String> {
    let (program, args) = scaffold_command(&template)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let mut child = Command::new(&program)
            .args(&args)
            .current_dir(&directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run scaffold: {}", e))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let Some(out) = stdout {
            let app2 = app.clone();
            std::thread::spawn(move || {
                use std::io::BufRead;
                let reader = std::io::BufReader::new(out);
                for line in reader.lines().flatten() {
                    let _ = app2.emit(
                        "scaffold-event",
                        ScaffoldPayload { kind: "stdout".into(), data: line },
                    );
                }
            });
        }
        if let Some(err) = stderr {
            let app2 = app.clone();
            std::thread::spawn(move || {
                use std::io::BufRead;
                let reader = std::io::BufReader::new(err);
                for line in reader.lines().flatten() {
                    let _ = app2.emit(
                        "scaffold-event",
                        ScaffoldPayload { kind: "stderr".into(), data: line },
                    );
                }
            });
        }

        let status = child.wait().map_err(|e| e.to_string())?;
        if status.success() {
            let _ = app.emit("scaffold-event", ScaffoldPayload { kind: "done".into(), data: String::new() });
            Ok(())
        } else {
            let msg = format!("Scaffold exited with code {:?}", status.code());
            let _ = app.emit("scaffold-event", ScaffoldPayload { kind: "error".into(), data: msg.clone() });
            Err(msg)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── Tauri commands: local session storage ────────────────────────────────

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
fn list_local_sessions() -> Result<Vec<SessionMetadata>, String> {
    let dir = sessions_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut sessions = Vec::new();
    if let Ok(read) = fs::read_dir(&dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(meta) = serde_json::from_str::<SessionMetadata>(&content) {
                        sessions.push(meta);
                    }
                }
            }
        }
    }
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

#[tauri::command]
fn save_local_session(
    id: String,
    title: String,
    directory: Option<String>,
) -> Result<SessionMetadata, String> {
    let dir = sessions_dir()?;
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let file_path = dir.join(format!("{}.json", id));
    let now = now_unix();
    let created_at = if file_path.exists() {
        fs::read_to_string(&file_path)
            .ok()
            .and_then(|c| serde_json::from_str::<SessionMetadata>(&c).ok())
            .map(|m| m.created_at)
            .unwrap_or(now)
    } else {
        now
    };
    let meta = SessionMetadata { id, title, created_at, updated_at: now, directory };
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())?;
    Ok(meta)
}

#[tauri::command]
fn delete_local_session(id: String) -> Result<(), String> {
    let dir = sessions_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn update_local_session_title(id: String, title: String) -> Result<(), String> {
    let dir = sessions_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    if !file_path.exists() {
        return Err("Session not found".to_string());
    }
    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let mut meta: SessionMetadata = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    meta.title = title;
    meta.updated_at = now_unix();
    let json = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(&file_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Entry point ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // The frontend reads resp.statusText / resp.contentType (src/lib/http-fetch.ts);
    // a snake_case payload would silently break web_fetch with a JS TypeError.
    #[test]
    fn http_fetch_response_serializes_to_camel_case() {
        let value = serde_json::to_value(HttpFetchResponse {
            status: 200,
            status_text: "OK".into(),
            content_type: "text/html".into(),
            body: "hi".into(),
        })
        .unwrap();
        let obj = value.as_object().unwrap();
        assert!(obj.contains_key("status"));
        assert!(obj.contains_key("statusText"));
        assert!(obj.contains_key("contentType"));
        assert!(obj.contains_key("body"));
        assert!(!obj.contains_key("status_text"));
        assert!(!obj.contains_key("content_type"));
    }

    // The frontend reads result.exitCode / result.timedOut (src/lib/run-python.ts);
    // a snake_case payload would silently break the run_python tool.
    #[test]
    fn python_run_result_serializes_to_camel_case() {
        let value = serde_json::to_value(PythonRunResult {
            stdout: "hi".into(),
            stderr: "".into(),
            exit_code: 0,
            timed_out: false,
        })
        .unwrap();
        let obj = value.as_object().unwrap();
        assert!(obj.contains_key("stdout"));
        assert!(obj.contains_key("stderr"));
        assert!(obj.contains_key("exitCode"));
        assert!(obj.contains_key("timedOut"));
        assert!(!obj.contains_key("exit_code"));
        assert!(!obj.contains_key("timed_out"));
    }

    // Live smoke test (network) — run explicitly: cargo test -- --ignored.
    // Uses Bing's RSS endpoint (the keyless-search primary) because DuckDuckGo
    // intermittently answers plain clients with a 202 anomaly challenge.
    #[test]
    #[ignore]
    fn http_fetch_live_smoke() {
        let resp = tauri::async_runtime::block_on(super::http_fetch(
            "https://www.bing.com/search?q=iceland+drone+rules&format=rss".into(),
            None,
        ))
        .expect("Bing RSS fetch should not error");
        assert_eq!(resp.status, 200, "Bing RSS should return 200, got {}", resp.status);
        assert!(resp.body.contains("<item>"), "Bing RSS should contain result items");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            ensure_chat_ui_directory,
            create_project_directory,
            list_project_directories,
            delete_project_directory,
            import_existing_directory,
            create_subdirectory,
            list_subdirectories,
            list_dir_entries,
            write_text_file,
            read_text_file,
            path_exists,
            remove_path,
            get_home_dir,
            get_opencode_config_path,
            opencode_status,
            opencode_install,
            opencode_serve_start,
            opencode_serve_stop,
            opencode_server_log,
            opencode_serve_in_dir,
            opencode_mcp_auth,
            http_fetch,
            run_python,
            run_scaffold,
            list_local_sessions,
            save_local_session,
            delete_local_session,
            update_local_session_title,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            kill_tracked_server();
        }
    });
}
