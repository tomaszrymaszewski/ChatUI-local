use std::fs;
use std::fs::OpenOptions;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Once};
use std::time::Duration;

use rusqlite::{params, params_from_iter, Connection};
use rusqlite::types::Value as SqlValue;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

/// Port of our own MCP OAuth callback listener. The flow that owns this port
/// receives the browser redirect and validates `state`.
const MCP_OAUTH_CALLBACK_PORT: u16 = 19876;

// Legacy OpenCode server (kept for the legacy agent half; coding delegation
// now shells out to installed coding-agent CLIs instead).
const OPENCODE_PORT: &str = "2138";
const OPENCODE_URL: &str = "http://localhost:2138";

static SERVER_PID: Mutex<Option<u32>> = Mutex::new(None);

/// PID of the currently running scaffold child (run_scaffold). Tracked so the
/// app can kill it on exit — a hung `npx`/`npm` child would otherwise keep the
/// scaffold command's blocking thread alive and stall shutdown.
static SCAFFOLD_PID: Mutex<Option<u32>> = Mutex::new(None);

/// Abort flag of the currently running native MCP OAuth flow (see
/// mcp_oauth_begin). Starting a new flow aborts the previous one so two flows
/// never race for the callback port.
static AUTH_FLOW: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

// ─── Structs ──────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub display_path: String,
    /// True when the entry is a directory (the agent-console folder viewer).
    pub is_dir: bool,
    /// File size in bytes (0 for directories).
    pub size: u64,
    /// Last-modified time as unix seconds (0 when unknown).
    pub modified_at: i64,
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
        is_dir: true,
        size: 0,
        modified_at: 0,
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
                        is_dir: true,
                        size: 0,
                        modified_at: 0,
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
        is_dir: true,
        size: 0,
        modified_at: 0,
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
        is_dir: true,
        size: 0,
        modified_at: 0,
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
                        is_dir: true,
                        size: 0,
                        modified_at: 0,
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
            let is_dir = ep.is_dir();
            let (size, modified_at) = entry
                .metadata()
                .map(|m| {
                    let modified = m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    (m.len(), modified)
                })
                .unwrap_or((0, 0));
            entries.push(DirEntry {
                name,
                path: ep.to_string_lossy().to_string(),
                display_path: make_display_path(&ep),
                is_dir,
                size,
                modified_at,
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

fn kill_scaffold_child() {
    if let Some(pid) = *SCAFFOLD_PID.lock().unwrap() {
        let _ = Command::new("kill").arg("-9").arg(pid.to_string()).output();
        *SCAFFOLD_PID.lock().unwrap() = None;
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

// ─── MCP OAuth (native — no external auth process) ─────────────────────────

/// App-owned OAuth token store (~/Documents/chatUI/mcp/auth.json).
fn mcp_auth_path() -> Result<PathBuf, String> {
    Ok(chat_ui_base_dir()?.join("mcp").join("auth.json"))
}

/// Legacy shared token store from the removed opencode integration — migrated
/// once into the app-owned store.
fn legacy_mcp_auth_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not find home directory".to_string())?;
    Ok(home
        .join(".local")
        .join("share")
        .join("opencode")
        .join("mcp-auth.json"))
}

/// Ensure the app-owned token store exists, migrating opencode's old
/// mcp-auth.json on first run (the original file is left untouched).
fn ensure_mcp_auth_file() -> Result<PathBuf, String> {
    let path = mcp_auth_path()?;
    if path.exists() {
        return Ok(path);
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if let Ok(legacy) = legacy_mcp_auth_path() {
        if legacy.exists() {
            if let Ok(content) = fs::read_to_string(&legacy) {
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                    write_mcp_auth(&path, &data)?;
                    return Ok(path);
                }
            }
        }
    }
    write_mcp_auth(&path, &serde_json::json!({}))?;
    Ok(path)
}

/// Read the MCP OAuth token store. Returns the raw JSON ("" when empty). The
/// frontend uses it to attach Bearer tokens to its own MCP connections and to
/// show sign-in status.
#[tauri::command]
fn read_mcp_auth() -> Result<String, String> {
    let path = ensure_mcp_auth_file()?;
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(_) => Ok(String::new()),
    }
}

/// Delete `name`'s entry from the parsed token store, returning whether an
/// entry was removed.
fn remove_mcp_auth_entry(data: &mut serde_json::Value, name: &str) -> bool {
    data.as_object_mut()
        .map(|o| o.remove(name).is_some())
        .unwrap_or(false)
}

/// Drop a connector's stored OAuth tokens + client registration (used when
/// the connector is uninstalled, so no credentials linger on disk).
#[tauri::command]
fn clear_mcp_auth(name: String) -> Result<bool, String> {
    let path = ensure_mcp_auth_file()?;
    let mut data: serde_json::Value = fs::read_to_string(&path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let removed = remove_mcp_auth_entry(&mut data, &name);
    if removed {
        write_mcp_auth(&path, &data)?;
    }
    Ok(removed)
}

/// RFC 8615 / MCP-spec well-known URL: for a resource at `origin` + `path`,
/// metadata lives at `{origin}/.well-known/{suffix}{path}` (the resource path
/// is appended after the well-known segment; query strings are stripped by
/// the caller).
fn well_known_url(origin: &str, path: &str, suffix: &str) -> String {
    if path.is_empty() || path == "/" {
        format!("{}/.well-known/{}", origin, suffix)
    } else {
        format!("{}/.well-known/{}{}", origin, suffix, path)
    }
}

/// Fetch a JSON document, returning None on any failure.
fn get_json(
    client: &reqwest::blocking::Client,
    url: &str,
) -> Option<serde_json::Value> {
    let resp = client.get(url).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<serde_json::Value>().ok()
}

/// Pull the `resource_metadata` URL out of a `WWW-Authenticate: Bearer ...`
/// challenge header (RFC 9728 §3: the server answers 401 on the MCP endpoint
/// itself when OAuth metadata lives somewhere the well-known URLs can't
/// guess, e.g. Zapier).
fn parse_resource_metadata_url(header: &str) -> Option<String> {
    let lower = header.to_lowercase();
    let bearer = lower.find("bearer")?;
    let rest = &header[bearer + "bearer".len()..];
    for param in rest.split(',') {
        let param = param.trim();
        let (key, value) = param.split_once('=')?;
        if key.trim().eq_ignore_ascii_case("resource_metadata") {
            let url = value.trim().trim_matches('"').trim().to_string();
            if !url.is_empty() {
                return Some(url);
            }
        }
    }
    None
}

/// Discover an MCP server's OAuth authorization metadata (MCP authorization
/// spec): the 401 challenge on the MCP endpoint itself points at the
/// protected-resource metadata when present (RFC 9728), otherwise the
/// well-known URLs derived from the server URL are tried. The
/// protected-resource metadata points at the authorization server, whose own
/// well-known metadata carries the endpoints.
fn discover_oauth_metadata(
    client: &reqwest::blocking::Client,
    server_url: &str,
) -> Result<serde_json::Value, String> {
    let url = reqwest::Url::parse(server_url)
        .map_err(|_| format!("Bad MCP server URL: {}", server_url))?;
    let origin = url.origin().ascii_serialization();
    let path = url.path().trim_end_matches('/').to_string();

    let mut issuer = origin.clone();
    // Prefer the server's own 401 challenge: it names the exact
    // protected-resource metadata document.
    if let Ok(resp) = client.get(server_url).send() {
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            if let Some(challenge) = resp.headers().get(reqwest::header::WWW_AUTHENTICATE) {
                if let Ok(text) = challenge.to_str() {
                    if let Some(meta_url) = parse_resource_metadata_url(text) {
                        if let Some(resource) = get_json(client, &meta_url) {
                            if let Some(server) = resource
                                .pointer("/authorization_servers/0")
                                .and_then(|v| v.as_str())
                            {
                                issuer = server.to_string();
                            }
                        }
                    }
                }
            }
        }
    }
    if issuer == origin {
        if let Some(resource) = get_json(
            client,
            &well_known_url(&origin, &path, "oauth-protected-resource"),
        ) {
            if let Some(server) = resource
                .pointer("/authorization_servers/0")
                .and_then(|v| v.as_str())
            {
                issuer = server.to_string();
            }
        }
    }

    if let Ok(issuer_url) = reqwest::Url::parse(&issuer) {
        let issuer_origin = issuer_url.origin().ascii_serialization();
        let issuer_path = issuer_url.path().trim_end_matches('/').to_string();
        for meta_url in [
            well_known_url(&issuer_origin, &issuer_path, "oauth-authorization-server"),
            format!("{}/.well-known/oauth-authorization-server", issuer_origin),
        ] {
            if let Some(meta) = get_json(client, &meta_url) {
                if meta.get("token_endpoint").is_some() {
                    return Ok(meta);
                }
            }
        }
    }
    Err("Could not discover OAuth metadata for this MCP server".to_string())
}

fn write_mcp_auth(path: &std::path::Path, data: &serde_json::Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, content.as_bytes()))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(unix))]
    {
        fs::write(path, content).map_err(|e| e.to_string())
    }
}

fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    let _ = getrandom::getrandom(&mut buf);
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

/// PKCE code verifier (hex — valid unreserved chars) + S256 challenge.
fn pkce_challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(verifier.as_bytes());
    base64url_nopad(&digest)
}

/// Standard base64 (URL-safe alphabet, no padding).
fn base64url_nopad(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(n >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[n as usize & 63] as char);
        }
    }
    out
}

/// Exchange an authorization code for tokens (public client + PKCE).
fn exchange_code(
    client: &reqwest::blocking::Client,
    token_endpoint: &str,
    code: &str,
    redirect_uri: &str,
    client_id: &str,
    client_secret: Option<&str>,
    code_verifier: &str,
) -> Result<serde_json::Value, String> {
    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code.to_string()),
        ("redirect_uri", redirect_uri.to_string()),
        ("client_id", client_id.to_string()),
        ("code_verifier", code_verifier.to_string()),
    ];
    if let Some(secret) = client_secret {
        form.push(("client_secret", secret.to_string()));
    }
    let resp = client
        .post(token_endpoint)
        .header("Accept", "application/json")
        .form(&form)
        .send()
        .map_err(|e| format!("Token request failed: {}", e))?;
    let status = resp.status();
    let body: serde_json::Value = resp.json().map_err(|e| format!("Bad token response: {}", e))?;
    if !status.is_success() {
        let msg = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!("Token exchange rejected ({}): {}", status, msg));
    }
    if body.get("access_token").and_then(|v| v.as_str()).is_none() {
        return Err("Token response missing access_token".to_string());
    }
    Ok(body)
}

/// Merge a fresh token set for `name` into the app-owned store.
fn store_mcp_tokens(
    name: &str,
    server_url: &str,
    client_id: &str,
    client_secret: Option<&str>,
    tokens: &serde_json::Value,
) -> Result<(), String> {
    let path = ensure_mcp_auth_file()?;
    let content = fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string());
    let mut data: serde_json::Value =
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}));

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    let mut token_obj = serde_json::Map::new();
    token_obj.insert(
        "accessToken".into(),
        serde_json::Value::String(
            tokens
                .get("access_token")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
        ),
    );
    if let Some(rt) = tokens.get("refresh_token").and_then(|v| v.as_str()) {
        token_obj.insert("refreshToken".into(), serde_json::Value::String(rt.to_string()));
    }
    if let Some(expires_in) = tokens.get("expires_in").and_then(|v| v.as_f64()) {
        token_obj.insert("expiresAt".into(), serde_json::json!(now + expires_in));
    }
    if let Some(scope) = tokens.get("scope").and_then(|v| v.as_str()) {
        token_obj.insert("scope".into(), serde_json::Value::String(scope.to_string()));
    }

    let mut client_info = serde_json::Map::new();
    client_info.insert("clientId".into(), serde_json::Value::String(client_id.to_string()));
    if let Some(secret) = client_secret {
        client_info.insert("clientSecret".into(), serde_json::Value::String(secret.to_string()));
    }
    client_info.insert("clientIdIssuedAt".into(), serde_json::json!(now));

    let entry = serde_json::json!({
        "tokens": serde_json::Value::Object(token_obj),
        "clientInfo": serde_json::Value::Object(client_info),
        "serverUrl": server_url,
    });
    if let Some(obj) = data.as_object_mut() {
        obj.insert(name.to_string(), entry);
    }
    write_mcp_auth(&path, &data)
}

/// Decode the `/callback?...` query of the OAuth redirect into
/// (code, state, error). Auth codes routinely contain percent-encoded
/// characters, so this parses with URL decoding instead of splitting raw.
fn parse_callback_params(path: &str) -> (Option<String>, Option<String>, Option<String>) {
    let full = format!("http://localhost{}", path);
    let url = match reqwest::Url::parse(&full) {
        Ok(u) => u,
        Err(_) => return (None, None, None),
    };
    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    let mut error: Option<String> = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            _ => {}
        }
    }
    (code, state, error)
}

/// One HTTP response line/body helper for the callback listener.
fn write_response(mut stream: std::net::TcpStream, status: &str, body: &str) {
    use std::io::Write as _;
    let head = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
}

/// Accept loop for the OAuth callback: wait for /callback?code=…&state=…,
/// validate state, then exchange the code and store the tokens. Exits when
/// the abort flag is set (a newer flow replaced this one) or after the code
/// was handled.
fn oauth_callback_loop(
    listener: TcpListener,
    abort: Arc<AtomicBool>,
    name: String,
    server_url: String,
    token_endpoint: String,
    client_id: String,
    client_secret: Option<String>,
    code_verifier: String,
    expected_state: String,
    redirect_uri: String,
) {
    for stream in listener.incoming() {
        if abort.load(Ordering::Relaxed) {
            return;
        }
        let mut stream = match stream {
            Ok(s) => s,
            Err(_) => continue,
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = [0u8; 4096];
        let n = match std::io::Read::read(&mut stream, &mut buf) {
            Ok(n) => n,
            Err(_) => continue,
        };
        let head = String::from_utf8_lossy(&buf[..n]);
        let request_line = head.lines().next().unwrap_or_default().to_string();
        let path = request_line.split_whitespace().nth(1).unwrap_or_default().to_string();

        if !path.starts_with("/callback") {
            write_response(stream, "404 Not Found", "Not found");
            continue;
        }
        let (code, state, error) = parse_callback_params(&path);
        if let Some(err) = error {
            let _ = err;
            write_response(
                stream,
                "200 OK",
                "<html><body><h2>Sign-in failed</h2><p>The provider returned an error. Return to ChatUI and try again.</p></body></html>",
            );
            return;
        }
        if code.is_none() || state.as_deref() != Some(expected_state.as_str()) {
            write_response(
                stream,
                "400 Bad Request",
                "<html><body><h2>Invalid or expired state parameter</h2><p>Return to ChatUI and start the sign-in again.</p></body></html>",
            );
            continue;
        }

        write_response(
            stream,
            "200 OK",
            "<html><body><h2>Sign-in complete</h2><p>You can close this tab and return to ChatUI.</p></body></html>",
        );

        let client = match reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
        {
            Ok(c) => c,
            Err(_) => return,
        };
        match exchange_code(
            &client,
            &token_endpoint,
            code.as_deref().unwrap_or_default(),
            &redirect_uri,
            &client_id,
            client_secret.as_deref(),
            &code_verifier,
        ) {
            Ok(tokens) => {
                if let Err(e) =
                    store_mcp_tokens(&name, &server_url, &client_id, client_secret.as_deref(), &tokens)
                {
                    eprintln!("[mcp-oauth] failed to store tokens for {}: {}", name, e);
                }
            }
            Err(e) => eprintln!("[mcp-oauth] token exchange failed for {}: {}", name, e),
        }
        return;
    }
}

/// A pre-registered public OAuth client for authorization servers that offer
/// no dynamic registration (RFC 7591) — per the MCP authorization spec, hosts
/// bring their own client identity for such servers. Keyed by the issuer in
/// the discovered authorization-server metadata.
struct StaticOauthClient {
    client_id: &'static str,
    client_secret: Option<&'static str>,
    /// Registered loopback callback host (RFC 8252: the port may vary).
    redirect_host: &'static str,
    /// Scopes to request; replaces the AS metadata's (GitHub advertises only
    /// "offline_access", which alone grants no API access).
    scopes: &'static str,
}

/// The static client for an authorization server, if one is known.
fn static_client_for(meta: &serde_json::Value) -> Option<StaticOauthClient> {
    let issuer = meta
        .get("issuer")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    if issuer == "https://github.com/login/oauth" {
        // The GitHub CLI's public OAuth app: its client secret is published
        // in gh's open source and safe to embed (the flow is PKCE-protected);
        // the registered callback is http://127.0.0.1/callback, so any
        // loopback port on 127.0.0.1 with that path is accepted.
        return Some(StaticOauthClient {
            client_id: "178c6fc778ccc68e1d6a",
            client_secret: Some("34ddeff2b558a23d38fba8a6de74f086ede1cc0b"),
            redirect_host: "127.0.0.1",
            scopes: "repo read:org read:user gist",
        });
    }
    None
}

/// Start a native OAuth sign-in for an MCP server: discover the server's
/// OAuth metadata, dynamically register a client (PKCE), bind the loopback
/// callback listener, and return the authorize URL for the browser. The code
/// exchange + token storage happen in the background; the frontend polls
/// read_mcp_auth to observe completion.
#[tauri::command]
async fn mcp_oauth_begin(name: String, server_url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Abort any previous flow so two sign-ins never race for the port.
        if let Some(prev) = AUTH_FLOW.lock().unwrap().as_ref() {
            prev.store(true, Ordering::Relaxed);
        }
        let abort = Arc::new(AtomicBool::new(false));
        *AUTH_FLOW.lock().unwrap() = Some(abort.clone());

        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        let meta = discover_oauth_metadata(&client, &server_url)?;
        let token_endpoint = meta
            .get("token_endpoint")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "OAuth metadata missing token_endpoint".to_string())?
            .to_string();
        let authorization_endpoint = meta
            .get("authorization_endpoint")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "OAuth metadata missing authorization_endpoint".to_string())?
            .to_string();
        let mut scopes: Vec<String> = meta
            .get("scopes_supported")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|s| s.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        // Dynamic client registration (RFC 7591) — the MCP-spec path.
        // Servers without it fall back to a pre-registered public client
        // (see static_client_for).
        let (client_id, client_secret, redirect_uri) =
            match meta.get("registration_endpoint").and_then(|v| v.as_str()) {
                Some(registration_endpoint) => {
                    let resp = client
                        .post(registration_endpoint)
                        .json(&serde_json::json!({
                            "client_name": "ChatUI",
                            "redirect_uris": [format!("http://localhost:{}/callback", MCP_OAUTH_CALLBACK_PORT)],
                            "grant_types": ["authorization_code"],
                            "response_types": ["code"],
                            "token_endpoint_auth_method": "none",
                        }))
                        .send()
                        .map_err(|e| format!("Client registration failed: {}", e))?;
                    let status = resp.status();
                    let body: serde_json::Value = resp.json().map_err(|e| format!("Bad registration response: {}", e))?;
                    if !status.is_success() {
                        let detail = body
                            .get("error_description")
                            .or_else(|| body.get("error"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown error");
                        return Err(format!(
                            "Client registration rejected ({}): {}",
                            status, detail
                        ));
                    }
                    let id = body
                        .get("client_id")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| "Registration response missing client_id".to_string())?
                        .to_string();
                    let secret = body
                        .get("client_secret")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    (
                        id,
                        secret,
                        format!("http://localhost:{}/callback", MCP_OAUTH_CALLBACK_PORT),
                    )
                }
                None => {
                    let sc = static_client_for(&meta).ok_or_else(|| {
                        "This MCP server does not support dynamic client registration, which this app needs for sign-in."
                            .to_string()
                    })?;
                    if !sc.scopes.is_empty() {
                        scopes = sc.scopes.split_whitespace().map(|s| s.to_string()).collect();
                    }
                    (
                        sc.client_id.to_string(),
                        sc.client_secret.map(|s| s.to_string()),
                        format!("http://{}:{}/callback", sc.redirect_host, MCP_OAUTH_CALLBACK_PORT),
                    )
                }
            };

        let code_verifier = random_token(32);
        let challenge = pkce_challenge(&code_verifier);
        let state = random_token(16);

        let mut authorize = reqwest::Url::parse(&authorization_endpoint)
            .map_err(|e| format!("Bad authorization endpoint: {}", e))?;
        authorize.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256");
        if !scopes.is_empty() {
            authorize.query_pairs_mut().append_pair("scope", &scopes.join(" "));
        }

        // Bind before returning so a busy port fails fast, then hand the
        // listener to the background loop that completes the flow.
        let listener = TcpListener::bind(("127.0.0.1", MCP_OAUTH_CALLBACK_PORT))
            .map_err(|e| format!("Could not bind the OAuth callback port: {}", e))?;
        std::thread::spawn(move || {
            oauth_callback_loop(
                listener,
                abort,
                name,
                server_url,
                token_endpoint,
                client_id,
                client_secret,
                code_verifier,
                state,
                redirect_uri,
            );
        });

        Ok(authorize.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Refresh an expired MCP OAuth access token using the stored refresh token
/// (standard OAuth2 refresh grant against the server's discovered token
/// endpoint), then write the fresh tokens back to the app-owned store. Runs
/// in Rust because the token endpoint rarely sends CORS headers, so the
/// webview couldn't call it directly.
#[tauri::command]
async fn refresh_mcp_token(name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = ensure_mcp_auth_file()?;
        let content = fs::read_to_string(&path)
            .map_err(|_| "No MCP auth data — sign in first".to_string())?;
        let mut data: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Bad mcp-auth.json: {}", e))?;
        let entry = data
            .get(&name)
            .ok_or_else(|| format!("No auth entry for MCP server: {}", name))?;
        let refresh_token = entry
            .pointer("/tokens/refreshToken")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "No refresh token — sign in again".to_string())?
            .to_string();
        let client_id = entry
            .pointer("/clientInfo/clientId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "No OAuth client info — sign in again".to_string())?
            .to_string();
        let client_secret = entry
            .pointer("/clientInfo/clientSecret")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let server_url = entry
            .get("serverUrl")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "No server URL stored — sign in again".to_string())?
            .to_string();

        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        let token_endpoint = discover_oauth_metadata(&client, &server_url)?
            .get("token_endpoint")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "OAuth metadata missing token_endpoint".to_string())?
            .to_string();

        let mut form = vec![
            ("grant_type", "refresh_token".to_string()),
            ("refresh_token", refresh_token.clone()),
            ("client_id", client_id),
        ];
        if let Some(secret) = client_secret {
            form.push(("client_secret", secret));
        }
        let resp = client
            .post(&token_endpoint)
            .header("Accept", "application/json")
            .form(&form)
            .send()
            .map_err(|e| format!("Token refresh request failed: {}", e))?;
        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .map_err(|e| format!("Bad token response: {}", e))?;
        if !status.is_success() {
            let msg = body
                .get("error_description")
                .or_else(|| body.get("error"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown error");
            return Err(format!("Token refresh rejected ({}): {}", status, msg));
        }
        let access_token = body
            .get("access_token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Token response missing access_token".to_string())?
            .to_string();

        // Write the fresh tokens back — only touch this server's `tokens`.
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let mut tokens = serde_json::Map::new();
        tokens.insert(
            "accessToken".into(),
            serde_json::Value::String(access_token.clone()),
        );
        let new_refresh = body
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or(refresh_token);
        tokens.insert("refreshToken".into(), serde_json::Value::String(new_refresh));
        if let Some(expires_in) = body.get("expires_in").and_then(|v| v.as_f64()) {
            tokens.insert("expiresAt".into(), serde_json::json!(now + expires_in));
        }
        if let Some(scope) = entry.pointer("/tokens/scope").and_then(|v| v.as_str()) {
            tokens.insert("scope".into(), serde_json::Value::String(scope.to_string()));
        }
        if let Some(e) = data.get_mut(&name).and_then(|e| e.as_object_mut()) {
            e.insert("tokens".into(), serde_json::Value::Object(tokens));
        }
        write_mcp_auth(&path, &data)?;

        Ok(access_token)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── Coding-agent detection ────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingAgentInfo {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// True when the binary can be found (known install location or PATH).
fn coding_agent_available(id: &str) -> Option<String> {
    if let Some(home) = dirs::home_dir() {
        let candidates: &[(&str, &str)] = match id {
            "opencode" => &[
                (".opencode/bin/opencode", "opencode"),
                (".local/bin/opencode", "opencode"),
            ],
            "claude" => &[
                (".claude/local/claude", "claude"),
                (".local/bin/claude", "claude"),
            ],
            "codex" => &[(".local/bin/codex", "codex")],
            _ => &[],
        };
        for (rel, _bin) in candidates {
            let candidate = home.join(rel);
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    // Fall back to PATH.
    if Command::new("which")
        .arg(id)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Some(id.to_string());
    }
    None
}

/// Detect installed local coding agents (for run_coding_task delegation).
#[tauri::command]
fn detect_coding_agents() -> Vec<CodingAgentInfo> {
    let known: &[(&str, &str)] = &[
        ("opencode", "OpenCode"),
        ("claude", "Claude Code"),
        ("codex", "Codex"),
    ];
    known
        .iter()
        .filter_map(|(id, name)| {
            coding_agent_available(id).map(|path| CodingAgentInfo {
                id: id.to_string(),
                name: name.to_string(),
                path,
            })
        })
        .collect()
}

// ─── Relaunch (update flow) ────────────────────────────────────────────────

/// Quit the app and reopen it. Used after an update is installed, where the
/// plugin-process `restart` relaunches the binary directly — which bypasses
/// LaunchServices and leaves the new instance without proper activation.
/// On macOS we instead spawn a detached shell that waits for this process to
/// exit (bounded), then `open`s the .app bundle so the new instance is
/// activated normally. Falls back to a direct binary spawn in dev.
#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    let pid = std::process::id();

    #[cfg(target_os = "macos")]
    {
        // current_exe: <bundle>.app/Contents/MacOS/<binary>
        let bundle_path = std::env::current_exe().ok().and_then(|exe| {
            let mut dir = exe;
            dir.pop(); // MacOS
            dir.pop(); // Contents
            dir.pop(); // <bundle>.app
            if dir
                .extension()
                .map(|e| e == "app")
                .unwrap_or(false)
            {
                Some(dir)
            } else {
                None
            }
        });

        if let Some(bundle) = bundle_path {
            let app_path = bundle.to_string_lossy().to_string();
            let script = format!(
                "for i in $(seq 1 50); do kill -0 {pid} 2>/dev/null || break; sleep 0.2; done; open \"{app_path}\""
            );
            let _ = Command::new("sh")
                .arg("-c")
                .arg(&script)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn();
            app.exit(0);
            return;
        }
    }

    // Fallback (dev / non-bundle): launch the current binary, then exit.
    if let Ok(exe) = std::env::current_exe() {
        let _ = Command::new(exe).spawn();
    }
    app.exit(0);
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRunResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub timed_out: bool,
}

/// Run a shell command for agent-mode tasks (the run_command tool). Same
/// safety pattern as run_python: pipes drained on separate threads, try_wait
/// polling, kill on timeout so a runaway command cannot hang the IPC call.
/// The command runs through a login shell (`sh -lc`) so the user's PATH
/// (homebrew, nvm, …) is available, optionally in a working directory.
#[tauri::command]
async fn run_command(
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<CommandRunResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Read;

        let timeout = Duration::from_millis(timeout_ms.unwrap_or(120_000));

        if let Some(dir) = cwd.as_deref() {
            let meta = fs::metadata(dir).map_err(|e| format!("Working directory {}: {}", dir, e))?;
            if !meta.is_dir() {
                return Err(format!("Working directory is not a folder: {}", dir));
            }
        }

        let mut cmd = Command::new("sh");
        cmd.arg("-lc").arg(&command);
        if let Some(dir) = cwd.as_deref() {
            cmd.current_dir(dir);
        }

        let mut child = cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start command: {}", e))?;

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
                Err(e) => return Err(format!("Failed to wait on command: {}", e)),
            }
        }

        let stdout = stdout_handle
            .and_then(|h| h.join().ok())
            .unwrap_or_default();
        let stderr = stderr_handle
            .and_then(|h| h.join().ok())
            .unwrap_or_default();

        let exit_code = final_status.and_then(|s| s.code()).unwrap_or(-1);

        // Bound the payloads crossing IPC.
        let stdout: String = stdout.chars().take(200_000).collect();
        let stderr: String = stderr.chars().take(200_000).collect();

        Ok(CommandRunResult { stdout, stderr, exit_code, timed_out })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ─── Local file access (sandboxed agents' read_file / write_file) ──────────

/// How much of a file is read from disk before byte truncation kicks in.
const LOCAL_FILE_MAX_BYTES: usize = 1024 * 1024;
/// Char cap for text crossing IPC to the model (same bound as run_python).
const LOCAL_FILE_MAX_CHARS: usize = 200_000;
/// Directory listings are capped at this many entries.
const LOCAL_FILE_MAX_ENTRIES: usize = 500;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileRead {
    pub path: String,
    /// "text" | "pdf-text" | "binary" | "directory"
    pub kind: String,
    pub size: u64,
    pub truncated: bool,
    pub content: String,
    pub note: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileWrite {
    pub path: String,
    pub bytes: usize,
    pub created: bool,
}

/// Expand a leading `~` to the user's home directory; anything else is used
/// as-is. The agent tools accept both `~/…` and absolute paths.
fn expand_tilde(path: &str) -> PathBuf {
    if path == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

/// Locate pdftotext (poppler). GUI apps launched from Finder/Dock do not
/// inherit the shell PATH, so probe the usual Homebrew locations first.
fn pdftotext_bin() -> Option<PathBuf> {
    for candidate in [
        "/opt/homebrew/bin/pdftotext",
        "/usr/local/bin/pdftotext",
        "/usr/bin/pdftotext",
    ] {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Ok(path_env) = std::env::var("PATH") {
        for dir in path_env.split(':') {
            let p = PathBuf::from(dir).join("pdftotext");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// True when the file starts with the `%PDF-` magic bytes.
fn starts_with_pdf_magic(path: &PathBuf) -> bool {
    use std::io::Read;
    let mut header = [0u8; 5];
    match fs::File::open(path) {
        Ok(mut f) => f.read_exact(&mut header).is_ok() && &header == b"%PDF-",
        Err(_) => false,
    }
}

/// NUL-byte sniff over the first 8 KiB — the standard "is this binary" check.
fn sniff_binary(buf: &[u8]) -> bool {
    buf.iter().take(8192).any(|&b| b == 0)
}

fn cap_chars(s: &str) -> (String, bool) {
    if s.chars().count() <= LOCAL_FILE_MAX_CHARS {
        return (s.to_string(), false);
    }
    (s.chars().take(LOCAL_FILE_MAX_CHARS).collect(), true)
}

/// Plain-text directory listing (folders marked with a trailing `/`),
/// capped at LOCAL_FILE_MAX_ENTRIES entries.
fn directory_listing(path: &PathBuf) -> String {
    let mut names: Vec<String> = Vec::new();
    if let Ok(read) = fs::read_dir(path) {
        for entry in read.flatten() {
            let is_dir = entry.path().is_dir();
            names.push(format!(
                "{}{}",
                entry.file_name().to_string_lossy(),
                if is_dir { "/" } else { "" }
            ));
            if names.len() >= LOCAL_FILE_MAX_ENTRIES {
                names.push("…".into());
                break;
            }
        }
    }
    names.sort_by_key(|n| n.to_lowercase());
    names.join("\n")
}

fn read_local_file_impl(raw_path: String) -> Result<LocalFileRead, String> {
    let p = expand_tilde(&raw_path);
    if !p.is_absolute() {
        return Err(format!("Path must be absolute (start with / or ~): {}", raw_path));
    }
    let meta = fs::metadata(&p).map_err(|e| format!("{}: {}", p.display(), e))?;
    let display = p.display().to_string();

    if meta.is_dir() {
        return Ok(LocalFileRead {
            path: display,
            kind: "directory".into(),
            size: 0,
            truncated: false,
            content: directory_listing(&p),
            note: None,
        });
    }
    if !meta.is_file() {
        return Err(format!("{} is not a regular file or folder", display));
    }
    let size = meta.len();

    // PDFs: extract the text with pdftotext (argv only — no shell involved).
    if starts_with_pdf_magic(&p) {
        let bin = pdftotext_bin().ok_or_else(|| {
            "This is a PDF, but pdftotext (poppler) is not installed. Ask the user to run: brew install poppler"
                .to_string()
        })?;
        let out = Command::new(bin)
            .arg("-layout")
            .arg(&p)
            .arg("-")
            .output()
            .map_err(|e| format!("Failed to run pdftotext: {}", e))?;
        if !out.status.success() {
            return Err(format!(
                "pdftotext failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        let full = String::from_utf8_lossy(&out.stdout);
        let (content, truncated) = cap_chars(&full);
        return Ok(LocalFileRead {
            path: display,
            kind: "pdf-text".into(),
            size,
            truncated,
            content,
            note: Some("Text extracted from the PDF with pdftotext — layout is preserved, but images and complex tables may be lost.".into()),
        });
    }

    // Regular files: read up to the byte cap (one extra byte detects truncation).
    use std::io::Read;
    let mut buf = Vec::new();
    fs::File::open(&p)
        .map_err(|e| format!("{}: {}", display, e))?
        .take(LOCAL_FILE_MAX_BYTES as u64 + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("{}: {}", display, e))?;
    let truncated = buf.len() > LOCAL_FILE_MAX_BYTES;
    if truncated {
        buf.truncate(LOCAL_FILE_MAX_BYTES);
    }
    if sniff_binary(&buf) {
        return Ok(LocalFileRead {
            path: display,
            kind: "binary".into(),
            size,
            truncated: false,
            content: String::new(),
            note: Some("Binary file — contents are not returned as text. Ask the user what to do with it (convert it, open it in an app, or describe what you need).".into()),
        });
    }
    let full = String::from_utf8_lossy(&buf);
    let (content, char_truncated) = cap_chars(&full);
    Ok(LocalFileRead {
        path: display,
        kind: "text".into(),
        size,
        truncated: truncated || char_truncated,
        content,
        note: None,
    })
}

fn write_local_file_impl(raw_path: String, content: String) -> Result<LocalFileWrite, String> {
    let p = expand_tilde(&raw_path);
    if !p.is_absolute() {
        return Err(format!("Path must be absolute (start with / or ~): {}", raw_path));
    }
    if p.is_dir() {
        return Err(format!("{} is a folder — cannot write to it", p.display()));
    }
    let parent = p
        .parent()
        .ok_or_else(|| format!("Invalid path: {}", p.display()))?;
    if !parent.is_dir() {
        return Err(format!(
            "Parent folder does not exist: {} (create it first)",
            parent.display()
        ));
    }
    let existed = p.exists();
    fs::write(&p, content.as_bytes())
        .map_err(|e| format!("Cannot write {}: {}", p.display(), e))?;
    Ok(LocalFileWrite {
        path: p.display().to_string(),
        bytes: content.len(),
        created: !existed,
    })
}

/// Read a local file for the sandboxed agents' read_file tool: text files
/// come back as text, PDFs are converted with pdftotext, folders come back
/// as a listing, binaries are refused with a note. The user approves every
/// call in the frontend before this runs (same approval card as run_command).
#[tauri::command]
async fn read_local_file(path: String) -> Result<LocalFileRead, String> {
    tauri::async_runtime::spawn_blocking(move || read_local_file_impl(path))
        .await
        .map_err(|e| e.to_string())?
}

/// Create or overwrite a local file for the sandboxed agents' write_file
/// tool. The parent folder must already exist; the user approves every call
/// in the frontend before this runs.
#[tauri::command]
async fn write_local_file(path: String, content: String) -> Result<LocalFileWrite, String> {
    tauri::async_runtime::spawn_blocking(move || write_local_file_impl(path, content))
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

        // Track the child so RunEvent::Exit can kill it — without this a hung
        // scaffold process would keep this blocking thread (and the app's
        // shutdown) alive indefinitely.
        {
            let mut guard = SCAFFOLD_PID.lock().unwrap();
            *guard = Some(child.id());
        }

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
        *SCAFFOLD_PID.lock().unwrap() = None;
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

// ─── Knowledge index (sqlite-vec) ─────────────────────────────────────────
//
// Persistent vector index for RAG. The frontend embeds text (local
// transformers.js model or a configured OpenAI-compatible /v1/embeddings
// endpoint) and stores f32 vectors here; every vec_* command below is a thin
// wrapper over the *_impl functions so tests can drive a plain in-memory
// Connection.

/// Global index connection, opened lazily on the first vec_* command.
static VEC_CONN: Mutex<Option<Connection>> = Mutex::new(None);

/// sqlite-vec is statically compiled into the binary (the sqlite-vec crate
/// builds its C source via `cc`). Registering its entry point as a SQLite
/// auto-extension makes every connection opened afterwards — including test
/// connections — load the vec0 virtual-table module.
static VEC_EXT_REGISTRATION: Once = Once::new();

fn register_vec_extension() {
    VEC_EXT_REGISTRATION.call_once(|| {
        unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        }
    });
}

fn vec_db_path() -> Result<PathBuf, String> {
    let base = chat_ui_base_dir()?;
    if !base.exists() {
        fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    }
    Ok(base.join("index.db"))
}

fn open_vec_connection() -> Result<Connection, String> {
    register_vec_extension();
    let conn = Connection::open(vec_db_path()?).map_err(|e| e.to_string())?;
    let _: String = conn
        .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_millis(5000))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn vec_global_conn() -> Result<std::sync::MutexGuard<'static, Option<Connection>>, String> {
    let mut guard = VEC_CONN
        .lock()
        .map_err(|_| "index connection lock poisoned".to_string())?;
    if guard.is_none() {
        *guard = Some(open_vec_connection()?);
    }
    Ok(guard)
}

const VEC_SCHEMA_VERSION: &str = "1";

/// One indexed chunk. A "source" (sourceType + sourceRef) is the indexing
/// unit: every upsert replaces ALL chunks of that source, so re-indexing a
/// message/file/skill with a changed chunk count needs no explicit deletes.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VecUpsertDoc {
    pub id: String,
    pub source_type: String,
    pub source_ref: String,
    pub source_title: Option<String>,
    pub chunk_index: i64,
    pub text: String,
    pub content_hash: String,
    /// Optional JSON payload (role, timestamp, projectId, …) echoed with hits.
    pub extra: Option<String>,
    pub embedding: Vec<f32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VecSearchHit {
    pub id: String,
    pub source_type: String,
    pub source_ref: String,
    pub source_title: Option<String>,
    pub chunk_index: i64,
    pub text: String,
    pub extra: Option<String>,
    pub distance: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VecSourceState {
    pub source_type: String,
    pub source_ref: String,
    pub content_hash: String,
    pub chunk_count: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VecInitResult {
    pub rebuilt: bool,
    pub dims: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VecStats {
    pub total_chunks: i64,
    pub by_source: std::collections::HashMap<String, i64>,
    pub embedding_model: Option<String>,
    pub dims: Option<i64>,
}

/// Little-endian f32 blob — the wire format sqlite-vec accepts for vectors.
fn f32_blob(vec: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vec.len() * 4);
    for v in vec {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    bytes
}

fn vec_meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM vec_meta WHERE key = ?1",
        [key],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

fn vec_meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO vec_meta (key, value) VALUES (?1, ?2)",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Create the schema for the given embedding model + dims, wiping stale data
/// when the model or dimension changed (vec0 tables have a fixed dimension —
/// vectors from different models can never be mixed). Returns true when
/// existing data was dropped.
fn vec_ensure_schema(conn: &Connection, embedding_model: &str, dims: i64) -> Result<bool, String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS vec_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
    )
    .map_err(|e| e.to_string())?;
    let existing_version = vec_meta_get(conn, "schema_version");
    let needs_rebuild = match &existing_version {
        None => false,
        Some(version) => {
            version != VEC_SCHEMA_VERSION
                || vec_meta_get(conn, "dims").and_then(|v| v.parse::<i64>().ok()) != Some(dims)
                || vec_meta_get(conn, "embedding_model").as_deref() != Some(embedding_model)
        }
    };
    if needs_rebuild {
        conn.execute_batch("DROP TABLE IF EXISTS vec_chunks; DROP TABLE IF EXISTS chunks;")
            .map_err(|e| e.to_string())?;
    }
    if existing_version.is_none() || needs_rebuild {
        vec_meta_set(conn, "schema_version", VEC_SCHEMA_VERSION)?;
        vec_meta_set(conn, "embedding_model", embedding_model)?;
        vec_meta_set(conn, "dims", &dims.to_string())?;
    }
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            source_type TEXT NOT NULL,
            source_ref TEXT NOT NULL,
            source_title TEXT,
            chunk_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            extra TEXT,
            updated_at INTEGER NOT NULL,
            UNIQUE(source_type, source_ref, chunk_index)
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks (source_type, source_ref);
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
            chunk_id TEXT PRIMARY KEY,
            embedding float[{dims}]
        );"
    ))
    .map_err(|e| e.to_string())?;
    Ok(needs_rebuild)
}

fn vec_upsert_impl(conn: &Connection, docs: &[VecUpsertDoc]) -> Result<usize, String> {
    if docs.is_empty() {
        return Ok(0);
    }
    let dims = vec_meta_get(conn, "dims")
        .and_then(|v| v.parse::<i64>().ok())
        .ok_or_else(|| "index not initialized — call vec_init first".to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    // Sources must appear as full chunk-sets; only the FIRST doc of a source
    // in this call clears that source's previous chunks (otherwise a later
    // doc would wipe the ones just inserted for the same source).
    let mut seen_sources: std::collections::HashSet<(String, String)> = Default::default();
    for doc in docs {
        if doc.id.is_empty() || doc.source_type.is_empty() || doc.source_ref.is_empty() {
            return Err("id, source_type and source_ref are required".to_string());
        }
        if doc.embedding.len() as i64 != dims {
            return Err(format!(
                "embedding dimension mismatch: index has {dims}, got {}",
                doc.embedding.len()
            ));
        }
        // Replace-all per source: drop the source's old vectors, then its rows.
        if seen_sources.insert((doc.source_type.clone(), doc.source_ref.clone())) {
            let stale: Vec<String> = {
                let mut stmt = tx
                    .prepare("SELECT id FROM chunks WHERE source_type = ?1 AND source_ref = ?2")
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(
                        [doc.source_type.as_str(), doc.source_ref.as_str()],
                        |r| r.get::<_, String>(0),
                    )
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<String>, _>>()
                    .map_err(|e| e.to_string())?
            };
            for stale_id in &stale {
                tx.execute("DELETE FROM vec_chunks WHERE chunk_id = ?1", [stale_id])
                    .map_err(|e| e.to_string())?;
            }
            tx.execute(
                "DELETE FROM chunks WHERE source_type = ?1 AND source_ref = ?2",
                [doc.source_type.as_str(), doc.source_ref.as_str()],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "INSERT OR REPLACE INTO chunks
                (id, source_type, source_ref, source_title, chunk_index, text, content_hash, extra, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                doc.id,
                doc.source_type,
                doc.source_ref,
                doc.source_title,
                doc.chunk_index,
                doc.text,
                doc.content_hash,
                doc.extra,
                now_unix(),
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO vec_chunks (chunk_id, embedding) VALUES (?1, ?2)",
            params![doc.id, f32_blob(&doc.embedding)],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(docs.len())
}

fn vec_delete_sources_impl(
    conn: &Connection,
    source_type: &str,
    source_refs: &[String],
) -> Result<(), String> {
    for source_ref in source_refs {
        let stale: Vec<String> = {
            let mut stmt = conn
                .prepare("SELECT id FROM chunks WHERE source_type = ?1 AND source_ref = ?2")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(
                    [source_type, source_ref.as_str()],
                    |r| r.get::<_, String>(0),
                )
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?
        };
        for stale_id in &stale {
            conn.execute("DELETE FROM vec_chunks WHERE chunk_id = ?1", [stale_id])
                .map_err(|e| e.to_string())?;
        }
        conn.execute(
            "DELETE FROM chunks WHERE source_type = ?1 AND source_ref = ?2",
            [source_type, source_ref.as_str()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn vec_search_impl(
    conn: &Connection,
    query: &[f32],
    limit: i64,
    source_types: Option<&[String]>,
    source_refs: Option<&[String]>,
    exclude_ids: Option<&[String]>,
) -> Result<Vec<VecSearchHit>, String> {
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let dims = vec_meta_get(conn, "dims")
        .and_then(|v| v.parse::<i64>().ok())
        .ok_or_else(|| "index not initialized — call vec_init first".to_string())?;
    if query.len() as i64 != dims {
        return Err(format!(
            "query dimension mismatch: index has {dims}, got {}",
            query.len()
        ));
    }
    let limit = limit.clamp(1, 50);
    // vec0's KNN cursor picks its k nearest vectors BEFORE the join filters
    // apply, so overfetch (clamped to vec0's k ≤ 512) to survive exclusions.
    let k = ((limit + exclude_ids.map(|e| e.len()).unwrap_or(0) as i64) * 3 + 8).min(512);
    let mut sql = String::from(
        "SELECT c.id, c.source_type, c.source_ref, c.source_title, c.chunk_index, c.text, c.extra, v.distance
         FROM vec_chunks v
         JOIN chunks c ON c.id = v.chunk_id
         WHERE v.embedding MATCH ?1 AND v.k = ?2",
    );
    let mut bound: Vec<SqlValue> = Vec::new();
    if let Some(types) = source_types.filter(|t| !t.is_empty()) {
        let placeholders = types.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        sql.push_str(&format!(" AND c.source_type IN ({placeholders})"));
        for t in types {
            bound.push(SqlValue::Text(t.clone()));
        }
    }
    if let Some(refs) = source_refs.filter(|r| !r.is_empty()) {
        let placeholders = refs.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        sql.push_str(&format!(" AND c.source_ref IN ({placeholders})"));
        for r in refs {
            bound.push(SqlValue::Text(r.clone()));
        }
    }
    if let Some(exclude) = exclude_ids.filter(|e| !e.is_empty()) {
        let placeholders = exclude.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        sql.push_str(&format!(" AND c.id NOT IN ({placeholders})"));
        for id in exclude {
            bound.push(SqlValue::Text(id.clone()));
        }
    }
    sql.push_str(" ORDER BY v.distance");
    sql.push_str(&format!(" LIMIT {limit}"));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut params_iter = vec![
        SqlValue::Blob(f32_blob(query)),
        SqlValue::Integer(k),
    ];
    params_iter.extend(bound);
    let rows = stmt
        .query_map(params_from_iter(params_iter.iter()), |row| {
            Ok(VecSearchHit {
                id: row.get(0)?,
                source_type: row.get(1)?,
                source_ref: row.get(2)?,
                source_title: row.get(3)?,
                chunk_index: row.get(4)?,
                text: row.get(5)?,
                extra: row.get(6)?,
                distance: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    for row in rows {
        hits.push(row.map_err(|e| e.to_string())?);
    }
    Ok(hits)
}

fn vec_source_states_impl(
    conn: &Connection,
    source_type: Option<&str>,
) -> Result<Vec<VecSourceState>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT source_type, source_ref, content_hash, COUNT(*) AS n
             FROM chunks
             WHERE (?1 IS NULL OR source_type = ?1)
             GROUP BY source_type, source_ref
             ORDER BY source_type, source_ref",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([source_type], |row| {
            Ok(VecSourceState {
                source_type: row.get(0)?,
                source_ref: row.get(1)?,
                content_hash: row.get(2)?,
                chunk_count: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut states = Vec::new();
    for row in rows {
        states.push(row.map_err(|e| e.to_string())?);
    }
    Ok(states)
}

fn vec_clear_impl(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("DELETE FROM vec_chunks; DELETE FROM chunks;")
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn vec_stats_impl(conn: &Connection) -> Result<VecStats, String> {
    let embedding_model = vec_meta_get(conn, "embedding_model");
    let dims = vec_meta_get(conn, "dims").and_then(|v| v.parse::<i64>().ok());
    let mut by_source = std::collections::HashMap::new();
    let mut total = 0i64;
    let mut stmt = conn
        .prepare("SELECT source_type, COUNT(*) FROM chunks GROUP BY source_type")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (k, n) = row.map_err(|e| e.to_string())?;
        total += n;
        by_source.insert(k, n);
    }
    Ok(VecStats {
        total_chunks: total,
        by_source,
        embedding_model,
        dims,
    })
}

#[tauri::command]
fn vec_init(embedding_model: String, dims: i64) -> Result<VecInitResult, String> {
    if !(8..=4096).contains(&dims) {
        return Err(format!("unsupported embedding dimension: {dims}"));
    }
    let guard = vec_global_conn()?;
    let conn = guard.as_ref().ok_or("index connection unavailable")?;
    let rebuilt = vec_ensure_schema(conn, &embedding_model, dims)?;
    Ok(VecInitResult { rebuilt, dims })
}

#[tauri::command]
fn vec_upsert(docs: Vec<VecUpsertDoc>) -> Result<usize, String> {
    let guard = vec_global_conn()?;
    let conn = guard.as_ref().ok_or("index connection unavailable")?;
    vec_upsert_impl(conn, &docs)
}

#[tauri::command]
fn vec_delete_sources(source_type: String, source_refs: Vec<String>) -> Result<(), String> {
    let guard = vec_global_conn()?;
    let conn = guard.as_ref().ok_or("index connection unavailable")?;
    vec_delete_sources_impl(conn, &source_type, &source_refs)
}

#[tauri::command]
fn vec_search(
    query_embedding: Vec<f32>,
    limit: i64,
    source_types: Option<Vec<String>>,
    source_refs: Option<Vec<String>>,
    exclude_ids: Option<Vec<String>>,
) -> Result<Vec<VecSearchHit>, String> {
    let guard = vec_global_conn()?;
    let conn = guard.as_ref().ok_or("index connection unavailable")?;
    vec_search_impl(
        conn,
        &query_embedding,
        limit,
        source_types.as_deref(),
        source_refs.as_deref(),
        exclude_ids.as_deref(),
    )
}

#[tauri::command]
fn vec_get_state(source_type: Option<String>) -> Result<Vec<VecSourceState>, String> {
    let guard = vec_global_conn()?;
    let conn = guard.as_ref().ok_or("index connection unavailable")?;
    vec_source_states_impl(conn, source_type.as_deref())
}

#[tauri::command]
fn vec_clear() -> Result<(), String> {
    let guard = vec_global_conn()?;
    let conn = guard.as_ref().ok_or("index connection unavailable")?;
    vec_clear_impl(conn)
}

#[tauri::command]
fn vec_stats() -> Result<VecStats, String> {
    let guard = vec_global_conn()?;
    let conn = guard.as_ref().ok_or("index connection unavailable")?;
    vec_stats_impl(conn)
}

// ─── Entry point ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // PKCE S256 challenge = base64url(SHA256(verifier)) — verified against a
    // known RFC 7636 appendix vector.
    #[test]
    fn pkce_challenge_matches_rfc7636_vector() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            super::pkce_challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn callback_params_decode_percent_encoded_code() {
        let (code, state, error) = super::parse_callback_params(
            "/callback?code=abc%2Fdef%3D123&state=xyz",
        );
        assert_eq!(code.as_deref(), Some("abc/def=123"));
        assert_eq!(state.as_deref(), Some("xyz"));
        assert_eq!(error, None);
    }

    #[test]
    fn callback_params_capture_provider_error() {
        let (code, state, error) =
            super::parse_callback_params("/callback?error=access_denied&state=xyz");
        assert_eq!(code, None);
        assert_eq!(state.as_deref(), Some("xyz"));
        assert_eq!(error.as_deref(), Some("access_denied"));
    }

    #[test]
    fn resource_metadata_url_prefers_challenge_value() {
        let header = r#"Bearer resource_metadata="https://mcp.zapier.com/.well-known/oauth-protected-resource/api/v1/connect", scope="openid""#;
        assert_eq!(
            super::parse_resource_metadata_url(header).as_deref(),
            Some("https://mcp.zapier.com/.well-known/oauth-protected-resource/api/v1/connect")
        );
    }

    #[test]
    fn resource_metadata_url_is_none_without_challenge() {
        assert_eq!(super::parse_resource_metadata_url("Basic realm=\"x\""), None);
        assert_eq!(super::parse_resource_metadata_url("Bearer scope=\"openid\""), None);
    }

    // Uninstalling a connector must drop only that connector's tokens, and
    // report whether anything was removed.
    #[test]
    fn remove_mcp_auth_entry_drops_only_named_entry() {
        let mut data = serde_json::json!({
            "zapier": {"tokens": {"accessToken": "a"}},
            "supabase": {"tokens": {"accessToken": "b"}},
        });
        assert!(super::remove_mcp_auth_entry(&mut data, "zapier"));
        assert_eq!(
            data,
            serde_json::json!({"supabase": {"tokens": {"accessToken": "b"}}})
        );
        assert!(!super::remove_mcp_auth_entry(&mut data, "zapier"));
        assert!(!super::remove_mcp_auth_entry(&mut data, "missing"));
        // A non-object store (corrupt file) removes nothing and must not panic.
        let mut junk = serde_json::json!("nope");
        assert!(!super::remove_mcp_auth_entry(&mut junk, "zapier"));
    }

    // GitHub's authorization server has no dynamic registration; sign-in
    // there rides on the pre-registered public client keyed by issuer.
    #[test]
    fn static_client_matches_github_issuer_only() {
        let github = serde_json::json!({ "issuer": "https://github.com/login/oauth" });
        let sc = super::static_client_for(&github).expect("github static client");
        assert_eq!(sc.client_id, "178c6fc778ccc68e1d6a");
        assert!(sc.client_secret.is_some());
        assert_eq!(sc.redirect_host, "127.0.0.1");
        assert!(sc.scopes.contains("repo"));

        let other = serde_json::json!({ "issuer": "https://mcp.notion.com" });
        assert!(super::static_client_for(&other).is_none());
        assert!(super::static_client_for(&serde_json::json!({})).is_none());
    }

    #[test]
    fn base64url_nopad_uses_url_safe_alphabet_without_padding() {
        assert_eq!(super::base64url_nopad(&[]), "");
        assert_eq!(super::base64url_nopad(&[0x00]), "AA");
        assert_eq!(super::base64url_nopad(&[0xff, 0xef]), "_-8");
        // 0xfb + 0xff + 0xff would produce '+'/'/' in standard base64.
        assert_eq!(super::base64url_nopad(&[0xfb, 0xff, 0xff]), "-___");
        assert!(!super::base64url_nopad(&[0xff, 0xff, 0xff]).contains('='));
    }

    #[test]
    fn random_token_is_hex_and_long_enough() {
        let a = super::random_token(32);
        let b = super::random_token(32);
        assert_eq!(a.len(), 64);
        assert_ne!(a, b, "two random tokens must differ");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

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

    // The frontend reads result.exitCode / result.timedOut (src/lib/run-command.ts);
    // a snake_case payload would silently break the run_command tool.
    #[test]
    fn command_run_result_serializes_to_camel_case() {
        let value = serde_json::to_value(CommandRunResult {
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

    // MCP OAuth metadata discovery follows RFC 8615 well-known URLs with the
    // resource path appended (query stripped): Supabase serves its protected-
    // resource metadata at /.well-known/oauth-protected-resource/mcp, Vulx at
    // the bare /.well-known/oauth-protected-resource. Getting this wrong
    // silently breaks token refresh.
    #[test]
    fn well_known_url_handles_root_and_path_resources() {
        assert_eq!(
            super::well_known_url("https://mcp.vulx.ai", "/", "oauth-protected-resource"),
            "https://mcp.vulx.ai/.well-known/oauth-protected-resource"
        );
        assert_eq!(
            super::well_known_url("https://mcp.vulx.ai", "", "oauth-protected-resource"),
            "https://mcp.vulx.ai/.well-known/oauth-protected-resource"
        );
        assert_eq!(
            super::well_known_url("https://mcp.supabase.com", "/mcp", "oauth-protected-resource"),
            "https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp"
        );
    }

    // The frontend reads result.kind / result.truncated / result.note
    // (src/lib/local-file.ts); a snake_case payload would silently break the
    // read_file tool.
    #[test]
    fn local_file_read_serializes_to_camel_case() {
        let value = serde_json::to_value(LocalFileRead {
            path: "/tmp/x".into(),
            kind: "text".into(),
            size: 2,
            truncated: false,
            content: "hi".into(),
            note: None,
        })
        .unwrap();
        let obj = value.as_object().unwrap();
        assert!(obj.contains_key("path"));
        assert!(obj.contains_key("kind"));
        assert!(obj.contains_key("size"));
        assert!(obj.contains_key("truncated"));
        assert!(obj.contains_key("content"));
        assert!(obj.contains_key("note"));
    }

    // The frontend reads result.bytes / result.created (src/lib/local-file.ts).
    #[test]
    fn local_file_write_serializes_to_camel_case() {
        let value = serde_json::to_value(LocalFileWrite {
            path: "/tmp/x".into(),
            bytes: 2,
            created: true,
        })
        .unwrap();
        let obj = value.as_object().unwrap();
        assert!(obj.contains_key("path"));
        assert!(obj.contains_key("bytes"));
        assert!(obj.contains_key("created"));
    }

    #[test]
    fn expand_tilde_resolves_home_and_leaves_other_paths() {
        let home = dirs::home_dir().unwrap();
        assert_eq!(expand_tilde("~"), home);
        assert_eq!(expand_tilde("~/Documents"), home.join("Documents"));
        assert_eq!(expand_tilde("/tmp/x"), PathBuf::from("/tmp/x"));
        assert_eq!(expand_tilde("relative"), PathBuf::from("relative"));
    }

    #[test]
    fn sniff_binary_detects_nul_bytes() {
        assert!(sniff_binary(b"abc\x00def"));
        assert!(!sniff_binary(b"abc\ndef\n"));
        // A NUL past the sniff window does not mark the file binary.
        let far = vec![b'a'; 9000];
        assert!(!sniff_binary(&far));
    }

    #[test]
    fn pdf_magic_detection() {
        let dir = std::env::temp_dir().join(format!("chatui-pdf-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let pdf = dir.join("fake.pdf");
        fs::write(&pdf, b"%PDF-1.7 fake").unwrap();
        assert!(starts_with_pdf_magic(&pdf));
        let txt = dir.join("t.txt");
        fs::write(&txt, b"plain text").unwrap();
        assert!(!starts_with_pdf_magic(&txt));
        let _ = fs::remove_dir_all(&dir);
    }

    // End-to-end behavior of the read/write helpers on real files: text
    // roundtrip, created vs overwrite, binary refusal, directory listing,
    // missing-parent refusal, and relative-path refusal.
    #[test]
    fn local_file_roundtrip_and_kinds() {
        let dir = std::env::temp_dir().join(format!("chatui-lf-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let txt = dir.join("note.txt");
        let txt_s = txt.to_string_lossy().to_string();

        let w = write_local_file_impl(txt_s.clone(), "hello".into()).unwrap();
        assert!(w.created);
        assert_eq!(w.bytes, 5);

        let r = read_local_file_impl(txt_s.clone()).unwrap();
        assert_eq!(r.kind, "text");
        assert_eq!(r.content, "hello");
        assert!(!r.truncated);

        let w2 = write_local_file_impl(txt_s.clone(), "hello again".into()).unwrap();
        assert!(!w2.created);

        let bin = dir.join("blob.bin");
        fs::write(&bin, [0x01, 0x00, 0x02]).unwrap();
        let rb = read_local_file_impl(bin.to_string_lossy().to_string()).unwrap();
        assert_eq!(rb.kind, "binary");
        assert!(rb.note.is_some());
        assert!(rb.content.is_empty());

        let rd = read_local_file_impl(dir.to_string_lossy().to_string()).unwrap();
        assert_eq!(rd.kind, "directory");
        assert!(rd.content.contains("note.txt"));
        assert!(rd.content.contains("blob.bin"));

        let bad = dir.join("nope").join("x.txt");
        assert!(write_local_file_impl(bad.to_string_lossy().to_string(), "x".into()).is_err());
        assert!(read_local_file_impl(dir.join("missing.txt").to_string_lossy().to_string()).is_err());
        assert!(read_local_file_impl("relative.txt".into()).is_err());
        assert!(write_local_file_impl("relative.txt".into(), "x".into()).is_err());

        let _ = fs::remove_dir_all(&dir);
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

    // Live smoke test (network) for MCP OAuth metadata discovery against every
    // OAuth connector in the frontend catalog (src/lib/mcp-catalog.ts) — run
    // explicitly: cargo test -- --ignored discover_oauth_metadata_catalog_live.
    // Keeps the discovery chain (401 challenge → protected-resource metadata →
    // authorization-server metadata) honest for each vendor.
    #[test]
    #[ignore]
    fn discover_oauth_metadata_catalog_live() {
        let urls = [
            "https://mcp.notion.com/mcp",
            "https://ai.todoist.net/mcp",
            "https://mcp.linear.app/mcp",
            "https://mcp.atlassian.com/v1/mcp",
            "https://mcp.zapier.com/api/v1/connect",
            "https://mcp.airtable.com/mcp",
            "https://mcp.figma.com/mcp",
            "https://mcp.webflow.com/mcp",
            "https://api.githubcopilot.com/mcp/",
            "https://mcp.vercel.com",
            "https://bindings.mcp.cloudflare.com/mcp",
            "https://mcp.postman.com/mcp",
            "https://mcp.supabase.com/mcp",
            "https://mcp.prisma.io/sse",
            "https://huggingface.co/mcp",
            "https://mcp.stripe.com",
            "https://mcp.paypal.com/mcp",
        ];
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap();
        let mut failed = Vec::new();
        for url in urls {
            match super::discover_oauth_metadata(&client, url) {
                Ok(meta) => {
                    let token = meta.get("token_endpoint").and_then(|v| v.as_str());
                    let authz = meta.get("authorization_endpoint").and_then(|v| v.as_str());
                    println!("ok   {:45} token={:?} authz={:?}", url, token, authz);
                    if token.is_none() || authz.is_none() {
                        failed.push(url);
                    }
                }
                Err(e) => {
                    println!("FAIL {:45} {}", url, e);
                    failed.push(url);
                }
            }
        }
        assert!(failed.is_empty(), "discovery failed for: {:?}", failed);
    }

    // ── Knowledge index (sqlite-vec) ──────────────────────────────────────

    // The frontend reads hit.sourceType / hit.sourceRef / hit.contentHash
    // (src/lib/knowledge-retrieval.ts); a snake_case payload would silently
    // break retrieval rendering.
    #[test]
    fn vec_structs_serialize_to_camel_case() {
        let hit = serde_json::to_value(super::VecSearchHit {
            id: "chat:s1:0:0".into(),
            source_type: "chat".into(),
            source_ref: "s1:0".into(),
            source_title: Some("Title".into()),
            chunk_index: 0,
            text: "hi".into(),
            extra: None,
            distance: 0.5,
        })
        .unwrap();
        let obj = hit.as_object().unwrap();
        assert!(obj.contains_key("sourceType"));
        assert!(obj.contains_key("sourceRef"));
        assert!(obj.contains_key("sourceTitle"));
        assert!(obj.contains_key("chunkIndex"));
        assert!(obj.contains_key("distance"));
        assert!(!obj.contains_key("source_type"));

        let stats = serde_json::to_value(super::VecStats {
            total_chunks: 1,
            by_source: [("chat".to_string(), 1)].into_iter().collect(),
            embedding_model: Some("Xenova/all-MiniLM-L6-v2".into()),
            dims: Some(384),
        })
        .unwrap();
        let obj = stats.as_object().unwrap();
        assert!(obj.contains_key("totalChunks"));
        assert!(obj.contains_key("bySource"));
        assert!(obj.contains_key("embeddingModel"));
        assert!(!obj.contains_key("total_chunks"));

        let state = serde_json::to_value(super::VecSourceState {
            source_type: "chat".into(),
            source_ref: "s1:0".into(),
            content_hash: "abc".into(),
            chunk_count: 2,
        })
        .unwrap();
        let obj = state.as_object().unwrap();
        assert!(obj.contains_key("sourceType"));
        assert!(obj.contains_key("contentHash"));
        assert!(obj.contains_key("chunkCount"));
    }

    fn vec_test_conn() -> Connection {
        super::register_vec_extension();
        Connection::open_in_memory().unwrap()
    }

    fn vec_doc(id: &str, source_ref: &str, embedding: &[f32]) -> super::VecUpsertDoc {
        super::VecUpsertDoc {
            id: id.into(),
            source_type: "chat".into(),
            source_ref: source_ref.into(),
            source_title: Some("Test chat".into()),
            chunk_index: 0,
            text: format!("text of {id}"),
            content_hash: format!("hash-{id}"),
            extra: None,
            embedding: embedding.to_vec(),
        }
    }

    // sqlite-vec loads via auto-extension and a vec0 KNN query ranks cosine-
    // nearest chunks first. This is the Phase 0 integration check: if the
    // static extension fails to link or register, this fails at runtime.
    #[test]
    fn vec_upsert_search_rank_exclude_and_replace() {
        let conn = vec_test_conn();
        assert!(!super::vec_ensure_schema(&conn, "test-model", 4).unwrap());

        // Unit vectors: a matches the query exactly, c partially, b not at all.
        // a and b are two chunks of source s1 (chunk_index 0 and 1).
        let a = vec_doc("a", "s1", &[1.0, 0.0, 0.0, 0.0]);
        let b = super::VecUpsertDoc {
            chunk_index: 1,
            ..vec_doc("b", "s1", &[0.0, 1.0, 0.0, 0.0])
        };
        let c = vec_doc("c", "s2", &[0.6, 0.8, 0.0, 0.0]);
        assert_eq!(super::vec_upsert_impl(&conn, &[a, b, c]).unwrap(), 3);

        let hits = super::vec_search_impl(&conn, &[1.0, 0.0, 0.0, 0.0], 3, None, None, None)
            .unwrap();
        assert_eq!(hits.len(), 3);
        assert_eq!(hits[0].id, "a");
        assert_eq!(hits[1].id, "c");
        assert_eq!(hits[2].id, "b");
        assert!(hits[0].distance < hits[1].distance);
        assert_eq!(hits[0].source_type, "chat");
        assert_eq!(hits[0].source_title.as_deref(), Some("Test chat"));

        // Excluding prior results widens the ranking to the remainder.
        let hits = super::vec_search_impl(
            &conn,
            &[1.0, 0.0, 0.0, 0.0],
            3,
            None,
            None,
            Some(&["a".to_string()]),
        )
        .unwrap();
        assert_eq!(hits[0].id, "c");

        // Source-type filter.
        let hits = super::vec_search_impl(
            &conn,
            &[1.0, 0.0, 0.0, 0.0],
            3,
            Some(&["file".to_string()]),
            None,
            None,
        )
        .unwrap();
        assert!(hits.is_empty());

        // Source-ref filter narrows to one source's chunks.
        let hits = super::vec_search_impl(
            &conn,
            &[1.0, 0.0, 0.0, 0.0],
            3,
            None,
            Some(&["s2".to_string()]),
            None,
        )
        .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, "c");

        // Upserting a source replaces all of its chunks (b gone, b2 added in
        // its place) — the call carries the source's full chunk-set again.
        let a_again = vec_doc("a", "s1", &[1.0, 0.0, 0.0, 0.0]);
        let b2 = super::VecUpsertDoc {
            chunk_index: 1,
            ..vec_doc("b2", "s1", &[0.0, 0.0, 1.0, 0.0])
        };
        super::vec_upsert_impl(&conn, &[a_again, b2]).unwrap();
        let hits = super::vec_search_impl(&conn, &[1.0, 0.0, 0.0, 0.0], 10, None, None, None).unwrap();
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert!(!ids.contains(&"b"));
        assert!(ids.contains(&"b2"));
        assert!(ids.contains(&"a"));

        // State reflects per-source chunk counts.
        let states = super::vec_source_states_impl(&conn, None).unwrap();
        assert_eq!(states.len(), 2);
        let s1 = states.iter().find(|s| s.source_ref == "s1").unwrap();
        assert_eq!(s1.chunk_count, 2);

        // Delete one source; only its chunks disappear.
        super::vec_delete_sources_impl(&conn, "chat", &["s1".to_string()]).unwrap();
        let hits = super::vec_search_impl(&conn, &[1.0, 0.0, 0.0, 0.0], 10, None, None, None).unwrap();
        let ids: Vec<&str> = hits.iter().map(|h| h.id.as_str()).collect();
        assert_eq!(ids, vec!["c"]);
    }

    // Switching embedding model/dims must wipe the index — vec0 tables have
    // a fixed dimension, so mixed-model vectors would silently corrupt search.
    #[test]
    fn vec_ensure_schema_rebuilds_on_model_change() {
        let conn = vec_test_conn();
        assert!(!super::vec_ensure_schema(&conn, "model-a", 4).unwrap());
        let doc = vec_doc("a", "s1", &[1.0, 0.0, 0.0, 0.0]);
        super::vec_upsert_impl(&conn, &[doc]).unwrap();

        // Same model + dims → no rebuild, data intact.
        assert!(!super::vec_ensure_schema(&conn, "model-a", 4).unwrap());
        assert_eq!(super::vec_stats_impl(&conn).unwrap().total_chunks, 1);

        // Different model → rebuild, data wiped.
        assert!(super::vec_ensure_schema(&conn, "model-b", 4).unwrap());
        assert_eq!(super::vec_stats_impl(&conn).unwrap().total_chunks, 0);

        // Different dims → also a rebuild, and upserts of the old size fail.
        assert!(super::vec_ensure_schema(&conn, "model-b", 8).unwrap());
        let wrong = vec_doc("w", "s1", &[1.0, 0.0, 0.0, 0.0]);
        assert!(super::vec_upsert_impl(&conn, &[wrong]).is_err());
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
            mcp_oauth_begin,
            read_mcp_auth,
            clear_mcp_auth,
            refresh_mcp_token,
            detect_coding_agents,
            http_fetch,
            relaunch_app,
            run_python,
            run_command,
            read_local_file,
            write_local_file,
            run_scaffold,
            list_local_sessions,
            save_local_session,
            delete_local_session,
            update_local_session_title,
            vec_init,
            vec_upsert,
            vec_delete_sources,
            vec_search,
            vec_get_state,
            vec_clear,
            vec_stats,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::Exit => {
            kill_tracked_server();
            kill_scaffold_child();
        }
        // macOS: the Dock icon was clicked. If the process is alive but the
        // window was lost (e.g. after a sleep/wake cycle or a stalled quit),
        // the default behavior is a no-op — show (or recreate) the window so
        // clicking the Dock always opens the app (tauri#12570).
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.unminimize();
                    let _ = win.set_focus();
                } else {
                    let _ = tauri::WebviewWindowBuilder::new(
                        app_handle,
                        "main",
                        tauri::WebviewUrl::default(),
                    )
                    .title("chatui")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(800.0, 600.0)
                    .hidden_title(true)
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .build();
                }
            }
        }
        _ => {}
    });
}
