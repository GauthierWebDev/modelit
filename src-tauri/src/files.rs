//! Accès à un modèle désigné par son chemin, sans dialogue (fichiers récents, glisser-déposer, ligne de
//! commande : overrides O-65, O-66, O-68). Le plugin fs n'autorise que les fichiers choisis dans un dialogue
//! pendant la session ; cette commande ajoute à sa portée un fichier `.mcd`, et lui seul.

use std::path::Path;

use tauri::AppHandle;
use tauri_plugin_fs::FsExt;

/// Le chemin désigne-t-il un modèle (extension `.mcd`, sans tenir compte de la casse) ?
fn is_model(path: &Path) -> bool {
    path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("mcd"))
}

/// Autorise la lecture et l'écriture du modèle `path` pour la session ; refuse tout autre fichier.
#[tauri::command]
pub fn allow_model_file(app: AppHandle, path: String) -> Result<(), String> {
    let path = Path::new(&path);
    if !is_model(path) {
        return Err(format!("not a model file: {}", path.display()));
    }
    app.fs_scope().allow_file(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_model;
    use std::path::Path;

    #[test]
    fn seuls_les_modeles_sont_acceptes() {
        assert!(is_model(Path::new("/tmp/commandes.mcd")));
        assert!(is_model(Path::new("C:\\Modèles\\Banque.MCD")));
        assert!(!is_model(Path::new("/etc/passwd")));
        assert!(!is_model(Path::new("/tmp/script.sql")));
        assert!(!is_model(Path::new("/tmp/mcd")));
    }
}
