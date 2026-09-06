use std::{env, fs, path::PathBuf};

fn main() {
    // Workaround: this repo's absolute path contains an apostrophe (Zachar't-Mentale).
    // tauri-winres escapes `'` as `\'` when writing the Windows .exe icon path into the
    // generated .rc file, which RC.EXE does not treat as a valid escape, so the resource
    // compile fails with "file not found". Point tauri-winres at a copy of the icon in a
    // path with no special characters instead of the real (apostrophe-containing) repo path.
    let icon_src = PathBuf::from("icons/icon.ico");
    let icon_copy = env::temp_dir().join("zachart-mentale-icon.ico");
    fs::copy(&icon_src, &icon_copy)
        .unwrap_or_else(|e| panic!("failed to copy {icon_src:?} to {icon_copy:?}: {e}"));

    let attributes = tauri_build::Attributes::new()
        .windows_attributes(tauri_build::WindowsAttributes::new().window_icon_path(icon_copy));

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
