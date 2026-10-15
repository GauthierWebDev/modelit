//! Coquille native. Toute la logique métier vit côté TypeScript (`src/core`) ;
//! Rust ne fournit que la fenêtre et l'accès au système (dialogues, fichiers, mises à jour).

mod mcp;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(mcp::McpState::default())
        .invoke_handler(tauri::generate_handler![mcp::mcp_start, mcp::mcp_stop, mcp::mcp_reply])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    #[cfg(target_os = "macos")]
    let builder = builder.menu(macos::menu).on_menu_event(macos::on_menu_event);
    builder
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}

/// Menu de l'application sous macOS : celui de Tauri par défaut, à trois éléments près.
/// - « About » ouvre la boîte À propos de l'interface (version, mainteneur, licence, nouveautés)
///   au lieu du panneau natif, qui ne montre que le nom et la version.
/// - « Quit » (⌘Q) appelle par défaut `terminate:`, qui arrête l'application sans passer par la
///   fermeture de la fenêtre : la confirmation des modifications non enregistrées serait
///   court-circuitée. Il ferme à la place la fenêtre principale, comme ⌘W ; l'application
///   s'arrête une fois sa dernière fenêtre fermée.
/// - « Close Window » (⌘W) devient « Close Tab » : ⌘W ferme l'onglet actif (override O-44), la
///   fenêtre se ferme avec ⇧⌘W.
#[cfg(target_os = "macos")]
mod macos {
    use tauri::menu::{Menu, MenuEvent, MenuItem, MenuItemKind, Submenu};
    use tauri::{AppHandle, Emitter, Manager, Runtime};

    const ABOUT_ID: &str = "about";
    const QUIT_ID: &str = "quit";
    const CLOSE_TAB_ID: &str = "close-tab";
    const CLOSE_WINDOW_ID: &str = "close-window";
    /// Événements écoutés par l'interface (`src/platform/window.ts`).
    const ABOUT_EVENT: &str = "menu-about";
    const CLOSE_TAB_EVENT: &str = "menu-close-tab";

    pub fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
        let menu = Menu::default(app)?;
        // Premier sous-menu : celui de l'application (À propos, Services, Masquer, Quitter).
        if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.first() {
            customize(app, app_menu)?;
        }
        for item in menu.items()? {
            if let MenuItemKind::Submenu(submenu) = item {
                replace_close_window(app, &submenu)?;
            }
        }
        Ok(menu)
    }

    /// Remplace « Close Window » (⌘W) par « Close Tab » (⌘W) et « Close Window » (⇧⌘W).
    fn replace_close_window<R: Runtime>(app: &AppHandle<R>, submenu: &Submenu<R>) -> tauri::Result<()> {
        for (position, item) in submenu.items()?.into_iter().enumerate() {
            if let MenuItemKind::Predefined(predefined) = &item {
                if predefined.text()?.starts_with("Close Window") {
                    submenu.remove(predefined)?;
                    let tab = MenuItem::with_id(app, CLOSE_TAB_ID, "Close Tab", true, Some("CmdOrCtrl+W"))?;
                    let window = MenuItem::with_id(app, CLOSE_WINDOW_ID, "Close Window", true, Some("CmdOrCtrl+Shift+W"))?;
                    submenu.insert(&tab, position)?;
                    submenu.insert(&window, position + 1)?;
                    return Ok(());
                }
            }
        }
        Ok(())
    }

    fn customize<R: Runtime>(app: &AppHandle<R>, app_menu: &Submenu<R>) -> tauri::Result<()> {
        for item in app_menu.items()? {
            if let MenuItemKind::Predefined(predefined) = &item {
                let text = predefined.text()?;
                if text.starts_with("About") || text.starts_with("Quit") {
                    app_menu.remove(predefined)?;
                }
            }
        }
        let name = &app.package_info().name;
        let about = MenuItem::with_id(app, ABOUT_ID, format!("About {name}"), true, None::<&str>)?;
        app_menu.insert(&about, 0)?;
        let quit = MenuItem::with_id(app, QUIT_ID, format!("Quit {name}"), true, Some("CmdOrCtrl+Q"))?;
        app_menu.append(&quit)
    }

    pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
        if event.id() == ABOUT_ID {
            let _ = app.emit(ABOUT_EVENT, ());
        } else if event.id() == CLOSE_TAB_ID {
            let _ = app.emit(CLOSE_TAB_EVENT, ());
        } else if event.id() == QUIT_ID || event.id() == CLOSE_WINDOW_ID {
            match app.get_webview_window("main") {
                // Déclenche `CloseRequested` : l'interface confirme si le modèle n'est pas enregistré.
                Some(window) => {
                    let _ = window.close();
                }
                None => app.exit(0),
            }
        }
    }
}
