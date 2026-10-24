//! Fichiers à ouvrir donnés par le système (override O-68) : arguments du lancement (`modelit a.mcd`,
//! double-clic sous Windows et Linux), second lancement transmis par l'instance unique, ouverture par le
//! Finder sous macOS (`RunEvent::Opened`). Tant que l'interface n'a pas demandé les fichiers du lancement
//! (`launch_files`), ils attendent ici ; ensuite ils lui sont envoyés (événement `open-files`).
//! L'interface ne garde que les modèles `.mcd` et signale les autres.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime, State};

/// Événement de l'interface : chemins absolus des fichiers à ouvrir.
pub const OPEN_FILES_EVENT: &str = "open-files";

#[derive(Default)]
pub struct LaunchState(Mutex<Pending>);

#[derive(Default)]
struct Pending {
    /// L'interface a demandé les fichiers du lancement : les suivants lui sont envoyés aussitôt.
    ready: bool,
    files: Vec<String>,
}

/// Arguments d'un lancement → chemins absolus des fichiers, dans l'ordre. Le premier argument (le programme),
/// les options (« -… ») et les liens (`modelit://…`, traités par le plugin deep-link) sont ignorés ; un
/// chemin relatif part de `cwd`.
pub fn file_arguments(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-') && !arg.contains("://"))
        .map(|arg| {
            let path = PathBuf::from(arg);
            let absolute = if path.is_absolute() { path } else { cwd.join(path) };
            absolute.to_string_lossy().into_owned()
        })
        .collect()
}

/// Fichiers reçus : envoyés à l'interface si elle est prête, sinon mis de côté pour `launch_files`.
pub fn deliver<R: Runtime>(app: &AppHandle<R>, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    let state = app.state::<LaunchState>();
    let mut pending = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if pending.ready {
        let _ = app.emit_to("main", OPEN_FILES_EVENT, files);
    } else {
        pending.files.extend(files);
    }
}

/// Second lancement (instance unique) : ses fichiers vont à la fenêtre ouverte, qui passe au premier plan.
/// Instance unique des seuls builds de release (`lib.rs`).
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn second_instance<R: Runtime>(app: &AppHandle<R>, argv: &[String], cwd: &str) {
    deliver(app, file_arguments(argv, Path::new(cwd)));
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Fichiers du lancement, demandés par l'interface une fois prête ; les suivants lui seront envoyés.
#[tauri::command]
pub fn launch_files(state: State<'_, LaunchState>) -> Vec<String> {
    let mut pending = state.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    pending.ready = true;
    std::mem::take(&mut pending.files)
}

#[cfg(test)]
mod tests {
    use super::file_arguments;
    use std::path::Path;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn programme_options_et_liens_ignores() {
        let found = file_arguments(&args(&["modelit", "-psn_0_1", "modelit://join/x", "a.mcd"]), Path::new("/w"));
        assert_eq!(found, vec![Path::new("/w").join("a.mcd").to_string_lossy().into_owned()]);
    }

    #[test]
    fn chemins_relatifs_depuis_le_dossier_courant() {
        let found = file_arguments(&args(&["modelit", "a.mcd", "sous/b.mcd"]), Path::new("/w"));
        let expected: Vec<String> =
            ["a.mcd", "sous/b.mcd"].iter().map(|p| Path::new("/w").join(p).to_string_lossy().into_owned()).collect();
        assert_eq!(found, expected);
    }

    #[test]
    fn sans_argument_aucun_fichier() {
        assert_eq!(file_arguments(&args(&["modelit"]), Path::new("/w")), Vec::<String>::new());
    }
}
