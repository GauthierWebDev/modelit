//! Point d'écoute MCP local (override O-47 ; docs/jalons/J-02_mcp.md).
//!
//! Rust ne fait que transporter : il écoute sur 127.0.0.1, refuse ce qui ne vient pas d'un client
//! local authentifié (jeton, en-têtes Host et Origin), puis relaie le corps JSON-RPC à la fenêtre
//! principale, qui le traite (`src/app/mcp/server.ts`) et renvoie la réponse par `mcp_reply`.

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tiny_http::{Header, Method, Request, Response, Server};

/// Taille maximale d'une requête (un script SQL de rétroconception peut être long).
const MAX_BODY: u64 = 5 * 1024 * 1024;
/// Délai maximal de traitement par l'interface.
const TIMEOUT: Duration = Duration::from_secs(60);
/// Événement écouté par la fenêtre principale (`src/platform/mcp.ts`).
const REQUEST_EVENT: &str = "mcp://request";

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Option<String>>>>>;

#[derive(Default)]
pub struct McpState {
    server: Mutex<Option<(Arc<Server>, thread::JoinHandle<()>)>>,
    pending: Pending,
    next: Arc<AtomicU64>,
}

#[derive(Clone, Serialize)]
struct McpRequest {
    id: u64,
    body: String,
    method: Option<String>,
}

fn header(request: &Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_owned())
}

fn reply(request: Request, status: u16, body: &str) {
    let content_type = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).expect("en-tête valide");
    let _ = request.respond(Response::from_string(body).with_status_code(status).with_header(content_type));
}

fn error(request: Request, status: u16, message: &str) {
    reply(request, status, &format!("{{\"error\":{}}}", serde_json::to_string(message).unwrap_or_default()));
}

/// Erreur JSON-RPC (code -32603) qui reprend l'identifiant de la requête : le client l'associe à
/// son appel, même quand l'interface n'a pas répondu.
fn rpc_error(request: Request, body: &str, message: &str) {
    let id = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("id").cloned())
        .unwrap_or(serde_json::Value::Null);
    let envelope = serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32603, "message": message } });
    reply(request, 200, &envelope.to_string());
}

/// Comparaison en temps constant (le jeton ne fuit pas par la durée de la réponse).
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn handle(app: &AppHandle, mut request: Request, port: u16, token: &str, pending: &Pending, next: &AtomicU64) {
    if request.url() != "/mcp" {
        return error(request, 404, "not found");
    }
    if request.method() != &Method::Post {
        return error(request, 405, "only POST is supported");
    }
    // Une page web ouverte dans un navigateur ne doit pas pouvoir piloter ModelIt.
    if header(&request, "Origin").is_some() {
        return error(request, 403, "requests from web pages are refused");
    }
    // Protection contre le « DNS rebinding » : l'hôte doit être la machine elle-même.
    let host = header(&request, "Host").unwrap_or_default();
    if host != format!("127.0.0.1:{port}") && host != format!("localhost:{port}") {
        return error(request, 403, "unexpected host");
    }
    let authorized = header(&request, "Authorization")
        .and_then(|v| v.strip_prefix("Bearer ").map(str::to_owned))
        .is_some_and(|t| same(&t, token));
    if !authorized {
        return error(request, 401, "missing or invalid token");
    }
    let mut body = String::new();
    if request.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
        return error(request, 400, "unreadable body");
    }
    let id = next.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = mpsc::channel();
    pending.lock().expect("verrou").insert(id, sender);
    let method = header(&request, "Mcp-Method");
    if app.emit_to("main", REQUEST_EVENT, McpRequest { id, body: body.clone(), method }).is_err() {
        pending.lock().expect("verrou").remove(&id);
        return rpc_error(request, &body, "ModelIt is not ready");
    }
    match receiver.recv_timeout(TIMEOUT) {
        Ok(Some(response)) => reply(request, 200, &response),
        // Notification : acceptée, sans réponse.
        Ok(None) => {
            let _ = request.respond(Response::empty(202));
        }
        Err(_) => {
            pending.lock().expect("verrou").remove(&id);
            rpc_error(request, &body, "ModelIt did not answer in time");
        }
    }
}

/// Démarre (ou redémarre) l'écoute sur 127.0.0.1:`port`.
#[tauri::command]
pub fn mcp_start(app: AppHandle, state: State<'_, McpState>, port: u16, token: String) -> Result<(), String> {
    mcp_stop(state.clone());
    if token.len() < 16 {
        return Err("token too short".into());
    }
    let server = Arc::new(Server::http(("127.0.0.1", port)).map_err(|e| e.to_string())?);
    let (pending, next) = (state.pending.clone(), state.next.clone());
    let listener = server.clone();
    let worker = thread::spawn(move || {
        for request in listener.incoming_requests() {
            let (app, token, pending, next) = (app.clone(), token.clone(), pending.clone(), next.clone());
            // Une requête peut attendre l'interface : chacune a son fil.
            thread::spawn(move || handle(&app, request, port, &token, &pending, &next));
        }
    });
    *state.server.lock().expect("verrou") = Some((server, worker));
    Ok(())
}

/// Arrête l'écoute ; les requêtes en attente reçoivent une erreur.
#[tauri::command]
pub fn mcp_stop(state: State<'_, McpState>) {
    if let Some((server, worker)) = state.server.lock().expect("verrou").take() {
        server.unblock();
        let _ = worker.join();
    }
    state.pending.lock().expect("verrou").clear();
}

/// Réponse de l'interface à la requête `id` (`None` : notification, pas de réponse).
#[tauri::command]
pub fn mcp_reply(state: State<'_, McpState>, id: u64, body: Option<String>) {
    if let Some(sender) = state.pending.lock().expect("verrou").remove(&id) {
        let _ = sender.send(body);
    }
}
