//! Commande `modelit` dans le PATH (override O-68), installée depuis les options générales. Elle lance
//! l'application installée et rend aussitôt le terminal ; les fichiers donnés arrivent par `launch.rs`.
//! - macOS : script `/usr/local/bin/modelit` qui appelle `open -a` (mot de passe administrateur demandé).
//! - Linux : script `~/.local/bin/modelit` qui lance l'exécutable (ou l'image `AppImage`) détaché.
//! - Windows : dossier de l'application ajouté au PATH de l'utilisateur (application graphique : la console
//!   est rendue d'elle-même).

use serde::Serialize;

/// Ligne qui signe les scripts installés par ModelIt : seul un script signé est remplacé ou retiré.
const MARKER: &str = "# ModelIt command line";

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    /// Système pris en charge, et application lancée depuis son installation (pas un build de développement).
    supported: bool,
    installed: bool,
    /// Emplacement de la commande (ou dossier ajouté au PATH sous Windows).
    location: Option<String>,
    /// Le dossier de la commande est dans le PATH (Linux : `~/.local/bin` ne l'est pas toujours).
    in_path: bool,
}

/// Script de la commande (macOS, Linux) : `launch` lance l'application avec les arguments reçus.
#[cfg_attr(target_os = "windows", allow(dead_code))]
fn unix_script(launch: &str) -> String {
    format!("#!/bin/sh\n{MARKER} (installed by ModelIt, removed from its options).\n{launch}\n")
}

/// Chaîne entre apostrophes pour le shell.
#[cfg_attr(target_os = "windows", allow(dead_code))]
fn shell_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
/// Même dossier d'un PATH Windows : sans tenir compte de la casse ni d'une barre oblique finale.
fn same_dir(a: &str, b: &str) -> bool {
    a.trim_end_matches(['\\', '/']).eq_ignore_ascii_case(b.trim_end_matches(['\\', '/']))
}

/// PATH Windows avec `dir` ajouté à la fin (inchangé s'il y est déjà).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn path_with(value: &str, dir: &str) -> String {
    if value.split(';').any(|entry| same_dir(entry, dir)) {
        return value.to_string();
    }
    let base = value.trim_end_matches(';');
    if base.is_empty() {
        dir.to_string()
    } else {
        format!("{base};{dir}")
    }
}

/// PATH Windows sans `dir`.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn path_without(value: &str, dir: &str) -> String {
    value.split(';').filter(|entry| !entry.is_empty() && !same_dir(entry, dir)).collect::<Vec<_>>().join(";")
}

#[cfg(target_os = "macos")]
mod system {
    use super::{shell_quote, unix_script, CliStatus, MARKER};
    use std::path::PathBuf;
    use std::process::Command;

    const TARGET: &str = "/usr/local/bin/modelit";

    /// Paquet `.app` de l'application (`X.app/Contents/MacOS/modelit`) ; absent pour un build de développement.
    fn bundle() -> Option<PathBuf> {
        let exe = std::env::current_exe().ok()?;
        let bundle = exe.ancestors().nth(3)?.to_path_buf();
        bundle.extension().is_some_and(|ext| ext == "app").then_some(bundle)
    }

    pub fn status() -> CliStatus {
        CliStatus {
            supported: bundle().is_some(),
            installed: std::fs::read_to_string(TARGET).is_ok_and(|s| s.contains(MARKER)),
            location: Some(TARGET.to_string()),
            in_path: true,
        }
    }

    /// Commande shell exécutée avec les droits d'administrateur (invite du système).
    fn as_admin(command: &str) -> Result<(), String> {
        let script = command.replace('\\', "\\\\").replace('"', "\\\"");
        let output = Command::new("osascript")
            .arg("-e")
            .arg(format!("do shell script \"{script}\" with administrator privileges"))
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }

    pub fn install() -> Result<(), String> {
        let bundle = bundle().ok_or("ModelIt is not running from an installed application")?;
        let launch = format!("exec open -a {} \"$@\"", shell_quote(&bundle.to_string_lossy()));
        let temp = std::env::temp_dir().join("modelit-command");
        std::fs::write(&temp, unix_script(&launch)).map_err(|e| e.to_string())?;
        let temp = shell_quote(&temp.to_string_lossy());
        as_admin(&format!("mkdir -p /usr/local/bin && cp {temp} {TARGET} && chmod 755 {TARGET} && rm -f {temp}"))
    }

    pub fn uninstall() -> Result<(), String> {
        if status().installed {
            as_admin(&format!("rm -f {TARGET}"))
        } else {
            Ok(())
        }
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod system {
    use super::{shell_quote, unix_script, CliStatus, MARKER};
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    fn target() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/bin/modelit"))
    }

    /// Exécutable à lancer : l'AppImage elle-même si l'application en vient, sinon le binaire installé.
    fn executable() -> Option<String> {
        std::env::var("APPIMAGE")
            .ok()
            .or_else(|| std::env::current_exe().ok().map(|p| p.to_string_lossy().into_owned()))
    }

    pub fn status() -> CliStatus {
        let target = target();
        let dir = target.as_ref().and_then(|t| t.parent().map(PathBuf::from));
        let in_path = dir
            .is_some_and(|dir| std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).any(|p| p == dir));
        CliStatus {
            supported: target.is_some() && executable().is_some(),
            installed: target.as_ref().is_some_and(|t| std::fs::read_to_string(t).is_ok_and(|s| s.contains(MARKER))),
            location: target.map(|t| t.to_string_lossy().into_owned()),
            in_path,
        }
    }

    pub fn install() -> Result<(), String> {
        let target = target().ok_or("HOME is not set")?;
        let exe = executable().ok_or("cannot find the ModelIt executable")?;
        if let Some(dir) = target.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let launch = format!("nohup {} \"$@\" >/dev/null 2>&1 &", shell_quote(&exe));
        std::fs::write(&target, unix_script(&launch)).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())
    }

    pub fn uninstall() -> Result<(), String> {
        match target() {
            Some(target) if status().installed => std::fs::remove_file(target).map_err(|e| e.to_string()),
            _ => Ok(()),
        }
    }
}

#[cfg(target_os = "windows")]
mod system {
    use super::{path_with, path_without, same_dir, CliStatus};
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    /// Pas de fenêtre de console pour PowerShell.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn dir() -> Option<String> {
        let exe = std::env::current_exe().ok()?;
        exe.parent().map(|d| d.to_string_lossy().into_owned())
    }

    /// PowerShell : `[Environment]` lit et écrit le PATH de l'utilisateur et prévient les autres programmes.
    fn powershell(script: &str, value: Option<&str>) -> Result<String, String> {
        let mut command = Command::new("powershell");
        command.args(["-NoProfile", "-NonInteractive", "-Command", script]).creation_flags(CREATE_NO_WINDOW);
        if let Some(value) = value {
            command.env("MODELIT_PATH", value);
        }
        let output = command.output().map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    }

    fn user_path() -> Result<String, String> {
        powershell("[Environment]::GetEnvironmentVariable('Path', 'User')", None)
    }

    fn set_user_path(value: &str) -> Result<(), String> {
        powershell("[Environment]::SetEnvironmentVariable('Path', $env:MODELIT_PATH, 'User')", Some(value)).map(|_| ())
    }

    pub fn status() -> CliStatus {
        let dir = dir();
        let installed = match (&dir, user_path()) {
            (Some(dir), Ok(path)) => path.split(';').any(|entry| same_dir(entry, dir)),
            _ => false,
        };
        CliStatus { supported: dir.is_some(), installed, location: dir, in_path: installed }
    }

    pub fn install() -> Result<(), String> {
        let dir = dir().ok_or("cannot find the ModelIt folder")?;
        set_user_path(&path_with(&user_path()?, &dir))
    }

    pub fn uninstall() -> Result<(), String> {
        let dir = dir().ok_or("cannot find the ModelIt folder")?;
        set_user_path(&path_without(&user_path()?, &dir))
    }
}

#[cfg(not(any(unix, target_os = "windows")))]
mod system {
    use super::CliStatus;

    pub fn status() -> CliStatus {
        CliStatus::default()
    }

    pub fn install() -> Result<(), String> {
        Err("unsupported system".into())
    }

    pub fn uninstall() -> Result<(), String> {
        Ok(())
    }
}

/// Exécuté hors du fil de l'interface : l'invite d'administrateur (macOS) ou PowerShell (Windows) peuvent durer.
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| e.to_string())?
}

/// État de la commande `modelit`.
///
/// # Errors
///
/// Si la tâche de lecture n'a pas pu s'exécuter.
#[tauri::command]
pub async fn cli_status() -> Result<CliStatus, String> {
    blocking(|| Ok(system::status())).await
}

/// Installe la commande `modelit` ; renvoie le nouvel état.
///
/// # Errors
///
/// Installation refusée (mot de passe administrateur annulé), impossible (build de développement) ou en échec.
#[tauri::command]
pub async fn cli_install() -> Result<CliStatus, String> {
    blocking(|| system::install().map(|()| system::status())).await
}

/// Retire la commande `modelit` ; renvoie le nouvel état.
///
/// # Errors
///
/// Retrait refusé ou en échec.
#[tauri::command]
pub async fn cli_uninstall() -> Result<CliStatus, String> {
    blocking(|| system::uninstall().map(|()| system::status())).await
}

#[cfg(test)]
mod tests {
    use super::{path_with, path_without, shell_quote, unix_script, MARKER};

    #[test]
    fn script_signe_qui_transmet_les_arguments() {
        let script = unix_script("exec open -a '/Applications/ModelIt.app' \"$@\"");
        assert!(script.starts_with("#!/bin/sh\n"));
        assert!(script.contains(MARKER));
        assert!(script.ends_with("\"$@\"\n"));
    }

    #[test]
    fn apostrophes_echappees_pour_le_shell() {
        assert_eq!(shell_quote("/Users/l'élève/ModelIt.app"), "'/Users/l'\\''élève/ModelIt.app'");
    }

    #[test]
    fn path_windows_ajout_sans_doublon() {
        assert_eq!(path_with("", r"C:\ModelIt"), r"C:\ModelIt");
        assert_eq!(path_with(r"C:\a;", r"C:\ModelIt"), r"C:\a;C:\ModelIt");
        assert_eq!(path_with(r"C:\a;c:\modelit\", r"C:\ModelIt"), r"C:\a;c:\modelit\");
    }

    #[test]
    fn path_windows_retrait() {
        assert_eq!(path_without(r"C:\a;C:\ModelIt\;C:\b", r"c:\modelit"), r"C:\a;C:\b");
        assert_eq!(path_without(r"C:\a", r"C:\ModelIt"), r"C:\a");
    }
}
