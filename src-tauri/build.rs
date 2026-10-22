/// Commandes de l'application : une permission `allow-<commande>` est générée pour chacune, et seule la
/// fenêtre principale les reçoit (`capabilities/default.json`) ; les fenêtres flottantes n'en ont aucune
/// (moindre privilège, audit A-01, P-3). À tenir à jour avec `generate_handler!` (`src/lib.rs`).
const COMMANDS: &[&str] = &[
    "mcp_start",
    "mcp_stop",
    "mcp_reply",
    "mcp_release_others",
    "collab_host_start",
    "collab_host_send",
    "collab_host_datagram",
    "collab_host_close",
    "collab_host_stop",
    "collab_guest_connect",
    "collab_guest_send",
    "collab_guest_datagram",
    "collab_guest_close",
    "updater_configured",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("échec de tauri-build");
}
