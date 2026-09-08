use tauri::{Emitter, Manager};

/// The extensions Windows can hand us. `zmap` is the one the installer
/// registers; `json` is here because a legacy map opened through
/// « Ouvrir avec » must work too.
const MIND_MAP_EXTENSIONS: [&str; 2] = ["zmap", "json"];

/// The mind map in a command line, if any.
///
/// Double-clicking an associated file launches the app as
/// `zachart-mentale.exe "C:\cours\fractions.zmap"`, so the path arrives as an
/// argument. Matching on the extension rather than taking `argv[1]` blindly
/// keeps a stray flag — or the `--` separator a `cargo tauri dev` run adds —
/// from being handed to the frontend as a file to open.
fn mind_map_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|arg| {
            let lower = arg.to_lowercase();
            MIND_MAP_EXTENSIONS
                .iter()
                .any(|extension| lower.ends_with(&format!(".{extension}")))
        })
        .cloned()
}

/// The map the app was launched to open, read fresh from the process's own
/// command line. Returns `None` for a normal launch, which is the common case.
#[tauri::command]
fn launch_mind_map() -> Option<String> {
    mind_map_arg(&std::env::args().collect::<Vec<_>>())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Registered FIRST, as the plugin requires. Without it, double-clicking a
    // second map while the app is open starts a SECOND copy of the editor —
    // and two copies autosaving the same file on a 500 ms debounce would take
    // turns overwriting each other's work. Instead the running instance is
    // handed the new argv, opens that map, and comes to the front.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        if let Some(path) = mind_map_arg(&argv) {
            let _ = app.emit("open-mind-map", path);
        }
        if let Some(window) = app.get_webview_window("main") {
            // Unminimized first: `set_focus` alone leaves a minimized window
            // minimized, so the file would open somewhere the user cannot see.
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![launch_mind_map])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::mind_map_arg;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn finds_the_map_windows_asked_us_to_open() {
        assert_eq!(
            mind_map_arg(&args(&["app.exe", r"C:\cours\fractions.zmap"])),
            Some(r"C:\cours\fractions.zmap".to_string())
        );
    }

    #[test]
    fn still_opens_a_legacy_json_map() {
        assert_eq!(
            mind_map_arg(&args(&["app.exe", r"C:\cours\fractions.json"])),
            Some(r"C:\cours\fractions.json".to_string())
        );
    }

    #[test]
    fn matches_the_extension_whatever_its_case() {
        assert_eq!(
            mind_map_arg(&args(&["app.exe", r"C:\cours\Fractions.ZMAP"])),
            Some(r"C:\cours\Fractions.ZMAP".to_string())
        );
    }

    #[test]
    fn ignores_the_executable_itself() {
        // The binary is not named like a map, but the guard matters: argv[0] is
        // never a file the user asked to open.
        assert_eq!(mind_map_arg(&args(&["fractions.zmap"])), None);
    }

    #[test]
    fn ignores_flags_and_unrelated_files() {
        assert_eq!(mind_map_arg(&args(&["app.exe"])), None);
        assert_eq!(mind_map_arg(&args(&["app.exe", "--flag", "notes.pdf"])), None);
    }
}
