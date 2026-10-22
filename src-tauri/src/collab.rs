//! Transport des sessions collaboratives (override O-05 ; J-01, phase 5a ; D3, D12).
//!
//! Pair-à-pair avec `iroh` : connexion directe quand c'est possible (même réseau, traversée de
//! NAT), sinon par des relais publics qui ne voient que du chiffré. Chaque pair est identifié par
//! sa clé publique, la connexion est chiffrée de bout en bout.
//!
//! Rust ne fait que transporter : des messages (texte JSON) encadrés par leur longueur sur un flux
//! QUIC bidirectionnel par invité, et des datagrammes (non fiables) pour le vocal (O-48, D18). Toute
//! la logique de session est en TypeScript (`src/app/collab/`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use bytes::Bytes;
use iroh::endpoint::{presets, Connection, RecvStream, SendStream};
use iroh::{Endpoint, EndpointAddr};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

/// Protocole applicatif annoncé à la connexion (ALPN).
pub const ALPN: &[u8] = b"modelit/collab/1";
/// Taille maximale d'un message (un document partagé est limité à 5 Mo, O-05 §10).
const MAX_FRAME: usize = 8 * 1024 * 1024;
/// Attente du relais de rattachement avant de produire l'adresse de l'hôte.
const ONLINE_TIMEOUT: Duration = Duration::from_secs(8);

type Sink = Arc<dyn Fn(Event) + Send + Sync>;
/// Invités de l'hôte : file d'envoi du flux et connexion (datagrammes), par identifiant.
type Peers = Arc<Mutex<HashMap<String, (mpsc::UnboundedSender<String>, Connection)>>>;

/// Ce que le transport signale à l'interface.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Message {
        peer: String,
        data: String,
    },
    /// Datagramme reçu (vocal) : perdu ou désordonné sans conséquence pour le reste.
    Datagram {
        peer: String,
        data: Vec<u8>,
    },
    Closed {
        peer: String,
    },
}

async fn write_frame(send: &mut SendStream, data: &[u8]) -> Result<(), String> {
    let len = u32::try_from(data.len()).map_err(|_| "message too large".to_string())?;
    send.write_all(&len.to_be_bytes()).await.map_err(|e| e.to_string())?;
    send.write_all(data).await.map_err(|e| e.to_string())
}

/// Message suivant ; `None` à la fin du flux.
async fn read_frame(recv: &mut RecvStream) -> Option<String> {
    let mut len = [0u8; 4];
    recv.read_exact(&mut len).await.ok()?;
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_FRAME {
        return None;
    }
    let mut data = vec![0u8; len];
    recv.read_exact(&mut data).await.ok()?;
    String::from_utf8(data).ok()
}

/// Relie un flux à l'interface : lecture vers `sink`, écriture depuis le canal renvoyé. `on_end` s'exécute
/// quand le flux se termine, avant l'événement `Closed` (l'hôte y oublie l'invité).
fn pump(
    peer: String,
    connection: Connection,
    mut send: SendStream,
    mut recv: RecvStream,
    sink: Sink,
    on_end: Box<dyn FnOnce() + Send>,
) -> mpsc::UnboundedSender<String> {
    let (sender, mut outgoing) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        while let Some(data) = outgoing.recv().await {
            if write_frame(&mut send, data.as_bytes()).await.is_err() {
                break;
            }
        }
        let _ = send.finish();
    });
    let (datagrams, datagram_sink, datagram_peer) = (connection.clone(), sink.clone(), peer.clone());
    tokio::spawn(async move {
        while let Ok(data) = datagrams.read_datagram().await {
            datagram_sink(Event::Datagram { peer: datagram_peer.clone(), data: data.to_vec() });
        }
    });
    tokio::spawn(async move {
        while let Some(data) = read_frame(&mut recv).await {
            sink(Event::Message { peer: peer.clone(), data });
        }
        connection.close(0u32.into(), b"bye");
        on_end();
        sink(Event::Closed { peer });
    });
    sender
}

/// Hôte : accepte les invités et leur parle, un flux par invité.
pub struct Host {
    endpoint: Endpoint,
    peers: Peers,
}

impl Host {
    /// Ouvre le point d'accès ; renvoie l'hôte et son adresse, à placer dans le lien d'invitation.
    pub async fn start(sink: Sink) -> Result<(Self, EndpointAddr), String> {
        let endpoint =
            Endpoint::builder(presets::N0).alpns(vec![ALPN.to_vec()]).bind().await.map_err(|e| e.to_string())?;
        // Rattachement à un relais (joignabilité depuis un autre réseau) ; sans lui, l'adresse ne
        // contient que les adresses directes, ce qui suffit sur un même réseau.
        let _ = tokio::time::timeout(ONLINE_TIMEOUT, endpoint.online()).await;
        let addr = endpoint.addr();
        let peers: Peers = Arc::default();
        let next = Arc::new(AtomicU64::new(1));
        let (accepting, table) = (endpoint.clone(), peers.clone());
        tokio::spawn(async move {
            while let Some(incoming) = accepting.accept().await {
                let (sink, table, next) = (sink.clone(), table.clone(), next.clone());
                tokio::spawn(async move {
                    let Ok(connection) = incoming.await else { return };
                    // L'invité ouvre le flux en envoyant son premier message (« hello »).
                    let Ok((send, recv)) = connection.accept_bi().await else { return };
                    let peer = format!("p{}", next.fetch_add(1, Ordering::Relaxed));
                    // Invité parti : retiré de la table (audit A-01, P-5). Inscription sous le verrou, pour
                    // qu'un flux terminé aussitôt ne laisse pas d'entrée orpheline.
                    let mut peers = table.lock().expect("verrou");
                    let (forget_table, forget_peer) = (table.clone(), peer.clone());
                    let forget = Box::new(move || {
                        forget_table.lock().expect("verrou").remove(&forget_peer);
                    });
                    let sender = pump(peer.clone(), connection.clone(), send, recv, sink, forget);
                    peers.insert(peer, (sender, connection));
                });
            }
        });
        Ok((Self { endpoint, peers }, addr))
    }

    pub fn send(&self, peer: &str, data: String) {
        if let Some((sender, _)) = self.peers.lock().expect("verrou").get(peer) {
            let _ = sender.send(data);
        }
    }

    /// Datagramme vers plusieurs invités (vocal) ; trop gros ou file pleine : abandonné.
    pub fn send_datagram(&self, peers: &[String], data: Bytes) {
        let table = self.peers.lock().expect("verrou");
        for peer in peers {
            if let Some((_, connection)) = table.get(peer) {
                let _ = connection.send_datagram(data.clone());
            }
        }
    }

    /// Ferme la connexion d'un invité (départ, exclusion, lien refusé).
    pub fn close(&self, peer: &str) {
        if let Some((_, connection)) = self.peers.lock().expect("verrou").remove(peer) {
            // Laisse le temps au dernier message (« ended », « rejected ») de partir.
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(300)).await;
                connection.close(0u32.into(), b"closed");
            });
        }
    }

    pub async fn stop(self) {
        let peers: Vec<_> = self.peers.lock().expect("verrou").drain().collect();
        tokio::time::sleep(Duration::from_millis(300)).await;
        for (_, (_, connection)) in peers {
            connection.close(0u32.into(), b"stopped");
        }
        self.endpoint.close().await;
    }
}

/// Invité : une connexion vers l'hôte.
pub struct Guest {
    endpoint: Endpoint,
    sender: mpsc::UnboundedSender<String>,
    connection: Connection,
}

impl Guest {
    pub async fn connect(addr: EndpointAddr, sink: Sink) -> Result<Self, String> {
        let endpoint = Endpoint::bind(presets::N0).await.map_err(|e| e.to_string())?;
        let connection = endpoint.connect(addr, ALPN).await.map_err(|e| e.to_string())?;
        let (send, recv) = connection.open_bi().await.map_err(|e| e.to_string())?;
        let sender = pump("host".into(), connection.clone(), send, recv, sink, Box::new(|| {}));
        Ok(Self { endpoint, sender, connection })
    }

    pub fn send(&self, data: String) {
        let _ = self.sender.send(data);
    }

    pub fn send_datagram(&self, data: Bytes) {
        let _ = self.connection.send_datagram(data);
    }

    pub async fn close(self) {
        tokio::time::sleep(Duration::from_millis(300)).await;
        self.connection.close(0u32.into(), b"left");
        self.endpoint.close().await;
    }
}

// ——— Commandes Tauri ———

#[derive(Default)]
pub struct CollabState {
    host: tokio::sync::Mutex<Option<Host>>,
    guest: tokio::sync::Mutex<Option<Guest>>,
}

#[derive(Clone, Serialize)]
struct Payload {
    peer: String,
    data: Option<String>,
}

/// Événements vers la fenêtre principale (`src/platform/collab.ts`).
fn sink(app: AppHandle, prefix: &'static str) -> Sink {
    Arc::new(move |event| {
        let (name, payload) = match event {
            Event::Message { peer, data } => (format!("{prefix}-message"), Payload { peer, data: Some(data) }),
            Event::Datagram { peer, data } => {
                (format!("{prefix}-datagram"), Payload { peer, data: Some(BASE64.encode(data)) })
            }
            Event::Closed { peer } => (format!("{prefix}-close"), Payload { peer, data: None }),
        };
        let _ = app.emit_to("main", &name, payload);
    })
}

/// Démarre l'hôte ; renvoie son adresse (JSON) pour le lien d'invitation.
#[tauri::command]
pub async fn collab_host_start(app: AppHandle, state: State<'_, CollabState>) -> Result<String, String> {
    if let Some(previous) = state.host.lock().await.take() {
        previous.stop().await;
    }
    let (host, addr) = Host::start(sink(app, "collab://host")).await?;
    *state.host.lock().await = Some(host);
    serde_json::to_string(&addr).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn collab_host_send(state: State<'_, CollabState>, peer: String, data: String) -> Result<(), String> {
    if let Some(host) = state.host.lock().await.as_ref() {
        host.send(&peer, data);
    }
    Ok(())
}

/// Datagramme (base64) vers les invités `peers` : vocal de l'hôte, ou relais d'un invité (O-48).
#[tauri::command]
pub async fn collab_host_datagram(
    state: State<'_, CollabState>,
    peers: Vec<String>,
    data: String,
) -> Result<(), String> {
    let bytes = BASE64.decode(data).map_err(|e| e.to_string())?;
    if let Some(host) = state.host.lock().await.as_ref() {
        host.send_datagram(&peers, Bytes::from(bytes));
    }
    Ok(())
}

#[tauri::command]
pub async fn collab_host_close(state: State<'_, CollabState>, peer: String) -> Result<(), String> {
    if let Some(host) = state.host.lock().await.as_ref() {
        host.close(&peer);
    }
    Ok(())
}

#[tauri::command]
pub async fn collab_host_stop(state: State<'_, CollabState>) -> Result<(), String> {
    if let Some(host) = state.host.lock().await.take() {
        host.stop().await;
    }
    Ok(())
}

/// Rejoint l'hôte dont l'adresse (JSON) vient du lien d'invitation.
#[tauri::command]
pub async fn collab_guest_connect(app: AppHandle, state: State<'_, CollabState>, addr: String) -> Result<(), String> {
    if let Some(previous) = state.guest.lock().await.take() {
        previous.close().await;
    }
    let addr: EndpointAddr = serde_json::from_str(&addr).map_err(|e| format!("invalid link: {e}"))?;
    let guest = Guest::connect(addr, sink(app, "collab://guest")).await?;
    *state.guest.lock().await = Some(guest);
    Ok(())
}

#[tauri::command]
pub async fn collab_guest_send(state: State<'_, CollabState>, data: String) -> Result<(), String> {
    if let Some(guest) = state.guest.lock().await.as_ref() {
        guest.send(data);
    }
    Ok(())
}

#[tauri::command]
pub async fn collab_guest_datagram(state: State<'_, CollabState>, data: String) -> Result<(), String> {
    let bytes = BASE64.decode(data).map_err(|e| e.to_string())?;
    if let Some(guest) = state.guest.lock().await.as_ref() {
        guest.send_datagram(Bytes::from(bytes));
    }
    Ok(())
}

#[tauri::command]
pub async fn collab_guest_close(state: State<'_, CollabState>) -> Result<(), String> {
    if let Some(guest) = state.guest.lock().await.take() {
        guest.close().await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    /// Spike 5a.0, local : un hôte et un invité iroh dans le même processus échangent des messages
    /// dans les deux sens, puis l'invité part et l'hôte le voit.
    #[tokio::test(flavor = "multi_thread")]
    async fn host_and_guest_exchange_messages() {
        let (to_test, mut events) = unbounded_channel::<Event>();
        let host_events = to_test.clone();
        let (host, addr) = Host::start(Arc::new(move |e| {
            let _ = host_events.send(e);
        }))
        .await
        .expect("hôte");
        let (guest_tx, mut guest_events) = unbounded_channel::<Event>();
        let guest = Guest::connect(
            addr,
            Arc::new(move |e| {
                let _ = guest_tx.send(e);
            }),
        )
        .await
        .expect("connexion");

        guest.send("{\"type\":\"hello\"}".into());
        let Some(Event::Message { peer, data }) =
            tokio::time::timeout(Duration::from_secs(10), events.recv()).await.expect("délai")
        else {
            panic!("message attendu");
        };
        assert_eq!(data, "{\"type\":\"hello\"}");

        let big = "x".repeat(2 * 1024 * 1024);
        host.send(&peer, big.clone());
        let Some(Event::Message { data, .. }) =
            tokio::time::timeout(Duration::from_secs(10), guest_events.recv()).await.expect("délai")
        else {
            panic!("réponse attendue");
        };
        assert_eq!(data.len(), big.len());

        // Datagrammes (vocal, O-48) dans les deux sens.
        guest.send_datagram(Bytes::from_static(b"\x01audio"));
        let Some(Event::Datagram { data, .. }) =
            tokio::time::timeout(Duration::from_secs(10), events.recv()).await.expect("délai")
        else {
            panic!("datagramme attendu");
        };
        assert_eq!(data, b"\x01audio");
        host.send_datagram(std::slice::from_ref(&peer), Bytes::from_static(b"\x01retour"));
        let Some(Event::Datagram { data, .. }) =
            tokio::time::timeout(Duration::from_secs(10), guest_events.recv()).await.expect("délai")
        else {
            panic!("datagramme attendu");
        };
        assert_eq!(data, b"\x01retour");

        guest.close().await;
        let closed = tokio::time::timeout(Duration::from_secs(10), events.recv()).await.expect("délai");
        assert_eq!(closed, Some(Event::Closed { peer }));
        // L'invité parti n'est plus gardé par l'hôte (P-5).
        assert!(host.peers.lock().expect("verrou").is_empty());
        host.stop().await;
    }
}
