use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Default)]
struct Workspace(Mutex<Option<PathBuf>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    path: String,
    name: String,
}

fn workspace_path(workspace: &tauri::State<Workspace>) -> Result<PathBuf, String> {
    workspace
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or("Open a folder first".into())
}

fn safe_file(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("Invalid file path".into());
    }
    let file = root
        .join(relative)
        .canonicalize()
        .map_err(|_| "File not found".to_string())?;
    if !file.starts_with(root)
        || file.extension().and_then(|extension| extension.to_str()) != Some("typ")
    {
        return Err("File is outside the selected folder or is not a .typ file".into());
    }
    Ok(file)
}

fn collect_typ_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<FileEntry>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_symlink() {
            continue;
        } else if kind.is_dir() {
            collect_typ_files(root, &path, files)?;
        } else if kind.is_file()
            && path.extension().and_then(|extension| extension.to_str()) == Some("typ")
        {
            let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
            files.push(FileEntry {
                path: relative.to_string_lossy().replace('\\', "/"),
                name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
            });
        }
    }
    Ok(())
}

#[tauri::command]
fn set_workspace(
    path: String,
    workspace: tauri::State<Workspace>,
) -> Result<Vec<FileEntry>, String> {
    let root = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "Folder not found".to_string())?;
    if !root.is_dir() {
        return Err("Select a folder".into());
    }
    let mut files = Vec::new();
    collect_typ_files(&root, &root, &mut files)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    *workspace.0.lock().unwrap() = Some(root);
    Ok(files)
}

#[tauri::command]
fn read_typ_file(path: String, workspace: tauri::State<Workspace>) -> Result<String, String> {
    let root = workspace_path(&workspace)?;
    fs::read_to_string(safe_file(&root, &path)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_typ_file(
    path: String,
    contents: String,
    workspace: tauri::State<Workspace>,
) -> Result<(), String> {
    let root = workspace_path(&workspace)?;
    fs::write(safe_file(&root, &path)?, contents).map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Workspace::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            set_workspace,
            read_typ_file,
            save_typ_file
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
