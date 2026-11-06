#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    io::{BufRead, BufReader},
    process::{Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() {
    eprintln!("desktop: starting");
    tauri::Builder::default()
        .setup(|app| {
            eprintln!("desktop: setup");
            let resources = app.path().resource_dir()?;
            let resources = if resources.join("runtime-id").exists() {
                resources
            } else {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            };
            let id = std::fs::read_to_string(resources.join("runtime-id"))?;
            if id.len() != 64 || !id.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Err("Invalid runtime ID".into());
            }
            let cache = match std::env::var_os("COMPOSED_HOME") {
                Some(home) => std::path::PathBuf::from(home).join("desktop-runtime"),
                None => app.path().app_cache_dir()?.join("runtime"),
            };
            std::fs::create_dir_all(&cache)?;
            let runtime = cache.join(id);
            if !runtime.exists() {
                let temporary = cache.join(format!("extract-{}", std::process::id()));
                std::fs::create_dir_all(&temporary)?;
                let result = Command::new("/usr/bin/tar")
                    .args(["-xzf"])
                    .arg(resources.join("runtime.tar.gz"))
                    .arg("-C")
                    .arg(&temporary)
                    .status()?;
                if !result.success() {
                    return Err("Runtime extraction failed".into());
                }
                if let Err(error) = std::fs::rename(&temporary, &runtime) {
                    if runtime.exists() {
                        std::fs::remove_dir_all(&temporary)?;
                    } else {
                        return Err(error.into());
                    }
                }
            }
            eprintln!("desktop: runtime {}", runtime.display());
            let mut child = Command::new(runtime.join("bin/composed"))
                .arg("desktop")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()?;
            eprintln!("desktop: bridge pid {}", child.id());
            let stdout = child.stdout.take().ok_or("Missing sidecar stdout")?;
            app.manage(Mutex::new(child));
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    let Ok(frame) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    let Some(url) = frame.get("url").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    let Ok(url) = tauri::Url::parse(url) else {
                        continue;
                    };
                    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
                        continue;
                    }
                    if let Some(window) = handle.get_webview_window("main") {
                        // A surviving editor transport reconnects without losing pending typing.
                        let _ = window.show();
                    } else {
                        let allowed = url.origin().ascii_serialization();
                        match WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                            .title("Composed")
                            .inner_size(1200.0, 850.0)
                            .on_navigation(move |target| {
                                target.origin().ascii_serialization() == allowed
                            })
                            .build()
                        {
                            Ok(window) => {
                                let _ = window.show();
                                let _ = window.set_focus();
                                eprintln!("desktop: window ready");
                            }
                            Err(error) => eprintln!("Window: {error}"),
                        }
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Composed desktop failed to start")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(child) = app.try_state::<Mutex<std::process::Child>>() {
                    if let Ok(mut child) = child.lock() {
                        // EOF detaches this window's client; studio decides whether it is idle.
                        child.stdin.take();
                    }
                }
            }
        });
}
