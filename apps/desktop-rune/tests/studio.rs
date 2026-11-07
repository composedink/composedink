//! The client against a real `composed studio`, both directions.
//!
//! Needs the composed CLI: run from the repo with
//! `COMPOSED_CLI=$PWD/apps/cli/bin/composed mise exec -- cargo test --test studio -- --nocapture`
//! inside `apps/desktop-rune` (mise puts the repo's Node on PATH). Skips without `COMPOSED_CLI`.

use composed_rune::link::{Command, Event, Link};
use composed_rune::post::Post;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command as Process, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

const POST: &str = "rune-e2e";

struct Studio {
    child: Child,
}

impl Drop for Studio {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn cli(bin: &Path, home: &Path, ports: (u16, u16), args: &[&str], stdin: Option<&str>) -> String {
    let mut child = Process::new(bin)
        .args(args)
        .env("COMPOSED_HOME", home)
        .env("COMPOSED_PORT", ports.0.to_string())
        .env("COMPOSED_ARTIFACT_PORT", ports.1.to_string())
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("run the composed CLI");
    if let Some(input) = stdin {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
    }
    let out = child.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "composed {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

/// Drain events into the post until `done` holds or ten seconds pass.
fn pump(link: &Link, post: &mut Post, done: impl Fn(&Post) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !done(post) {
        assert!(
            Instant::now() < deadline,
            "timed out; draft is {:?}",
            post.edit.text
        );
        let Ok(event) = link.events.recv_timeout(Duration::from_millis(100)) else {
            continue;
        };
        match event {
            Event::Snapshot { doc, bytes } if doc == post.id => {
                for command in post.snapshot(&bytes) {
                    link.send(command);
                }
            }
            Event::Update { doc, bytes } if doc == post.id => post.update(&bytes),
            Event::Ack { doc, seq } if doc == post.id => post.ack(seq),
            Event::Notice(message) => panic!("studio said: {message}"),
            _ => {}
        }
    }
}

#[test]
fn typing_reaches_the_studio_and_studio_changes_reach_the_draft() {
    let Some(bin) = std::env::var_os("COMPOSED_CLI").map(PathBuf::from) else {
        eprintln!("skipped: set COMPOSED_CLI to the composed CLI");
        return;
    };
    let home = tempfile::tempdir().unwrap();
    let ports = (free_port(), free_port());
    cli(&bin, home.path(), ports, &["new", "post", POST], None);

    let _studio = Studio {
        child: Process::new(&bin)
            .args(["studio", "--headless"])
            .env("COMPOSED_HOME", home.path())
            .env("COMPOSED_PORT", ports.0.to_string())
            .env("COMPOSED_ARTIFACT_PORT", ports.1.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    };

    let link = Link::spawn(home.path().to_path_buf(), Arc::new(|| {}));
    let mut post = Post::new(POST);
    link.send(Command::Open(POST.into()));
    pump(&link, &mut post, |p| p.loaded);
    let original = post.edit.text.clone();

    // 1. Type in the client; the studio stores it and the CLI reads it back.
    post.edit
        .text
        .push_str("\nTyped natively in rune — ünïcode included.\n");
    let typed = post.edit.text.clone();
    if let Some(command) = post.push_local() {
        link.send(command);
    }
    pump(&link, &mut post, |p| p.unsaved() == 0);
    let stored = cli(&bin, home.path(), ports, &["cat", POST], None);
    assert!(
        stored.contains("Typed natively in rune — ünïcode included."),
        "studio has the typing: {stored:?}"
    );
    assert_eq!(stored.trim_end(), typed.trim_end());

    // 2. A change made elsewhere (here a direct human apply through the CLI) arrives as an
    //    update, and the caret stays on the same character.
    let caret = post.edit.text.find("natively").unwrap();
    post.edit.set_caret(caret);
    let read: serde_json::Value = serde_json::from_str(&cli(
        &bin,
        home.path(),
        ports,
        &["cat", POST, "--json"],
        None,
    ))
    .unwrap();
    let edited = format!("{}Edited elsewhere.\n", read["text"].as_str().unwrap());
    let base = read["base"].as_str().unwrap().to_owned();
    cli(
        &bin,
        home.path(),
        ports,
        &["apply", POST, "--base", &base, "--direct", "--i-am-human"],
        Some(&edited),
    );
    pump(&link, &mut post, |p| {
        p.edit.text.contains("Edited elsewhere.")
    });
    let (at, _) = post.edit.range();
    assert_eq!(
        &post.edit.text[at..at + "natively".len()],
        "natively",
        "caret held across the update"
    );
    assert!(
        post.edit
            .text
            .starts_with(&original[..original.len().min(20)])
    );
    eprintln!("final draft:\n{}", post.edit.text);
}
