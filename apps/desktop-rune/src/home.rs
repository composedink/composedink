//! `$COMPOSED_HOME`: where the studio advertises its socket and where documents live.
//!
//! The client reads three things and writes none: `owner.json` (the authority's socket URL and
//! readiness), `session.token` (the socket's shared secret) and the names of `docs/` entries (the
//! store names each document directory with the base64url of its id). Every change goes through
//! the studio; this module never opens a Loro file.

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// `$COMPOSED_HOME`, else `~/.composed` (the CLI's default).
pub fn composed_home() -> PathBuf {
    if let Some(home) = std::env::var_os("COMPOSED_HOME") {
        return PathBuf::from(home);
    }
    let user = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    user.join(".composed")
}

#[derive(Debug, Deserialize)]
struct Owner {
    kind: Option<String>,
    socket: Option<String>,
    ready: Option<bool>,
}

/// What a client needs to open the studio socket.
#[derive(Debug, Clone, PartialEq)]
pub struct StudioAddress {
    /// `ws://127.0.0.1:<port>/`, from `owner.json`.
    pub socket: String,
    pub token: String,
}

impl StudioAddress {
    /// The `Origin` the studio insists on: `http://` and the socket's host.
    pub fn origin(&self) -> String {
        let rest = self
            .socket
            .split_once("://")
            .map_or(self.socket.as_str(), |(_, r)| r);
        let host = rest.split('/').next().unwrap_or(rest);
        format!("http://{host}")
    }

    /// The socket URL with the token. `owner.json` holds `ws://host:port` with no path.
    pub fn url(&self) -> String {
        let rest = self.socket.split_once("://").map_or("", |(_, r)| r);
        let slash = if rest.contains('/') { "" } else { "/" };
        format!("{}{slash}?token={}", self.socket, self.token)
    }
}

/// Why there is no studio to talk to, phrased as the fix a person types.
#[derive(Debug, Clone, PartialEq)]
pub enum NoStudio {
    NotRunning,
    NotReady,
    /// Only a short CLI command owns the authority; it exits on its own.
    Inline,
}

impl NoStudio {
    pub fn fix(&self) -> &'static str {
        match self {
            NoStudio::NotRunning => "Studio isn't running. fix: composed studio",
            NoStudio::NotReady => "Studio is starting…",
            NoStudio::Inline => "A composed command holds the authority; retrying…",
        }
    }
}

pub fn studio_address(home: &Path) -> Result<StudioAddress, NoStudio> {
    let owner =
        std::fs::read_to_string(home.join("owner.json")).map_err(|_| NoStudio::NotRunning)?;
    let owner: Owner = serde_json::from_str(&owner).map_err(|_| NoStudio::NotRunning)?;
    match owner.kind.as_deref() {
        Some("studio") => {}
        Some("inline") => return Err(NoStudio::Inline),
        _ => return Err(NoStudio::NotRunning),
    }
    if owner.ready != Some(true) {
        return Err(NoStudio::NotReady);
    }
    let socket = owner.socket.ok_or(NoStudio::NotRunning)?;
    let token =
        std::fs::read_to_string(home.join("session.token")).map_err(|_| NoStudio::NotRunning)?;
    Ok(StudioAddress {
        socket,
        token: token.trim().to_owned(),
    })
}

/// Post ids in the store, sorted. Components (`scope/name`) are left out: posts are slugs.
///
/// This reads directory names only. The studio has no listing operation yet; when it gains one
/// (`doc.list`), this becomes a socket call.
pub fn list_posts(home: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(home.join("docs")) else {
        return Vec::new();
    };
    let mut posts: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            let id =
                String::from_utf8(URL_SAFE_NO_PAD.decode(name.trim_end_matches('=')).ok()?).ok()?;
            (!id.contains('/') && !id.contains(':')).then_some(id)
        })
        .collect();
    posts.sort();
    posts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir_for(id: &str) -> String {
        URL_SAFE_NO_PAD.encode(id)
    }

    #[test]
    fn posts_are_decoded_slugs_and_components_are_left_out() {
        let home = tempfile::tempdir().unwrap();
        for id in ["second-post", "first-post", "lachieh/hello"] {
            std::fs::create_dir_all(home.path().join("docs").join(dir_for(id)).join("updates"))
                .unwrap();
        }
        std::fs::write(home.path().join("docs").join("stray.tmp"), b"").unwrap();
        assert_eq!(list_posts(home.path()), ["first-post", "second-post"]);
    }

    #[test]
    fn a_ready_studio_gives_its_socket_token_and_origin() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(studio_address(home.path()), Err(NoStudio::NotRunning));
        std::fs::write(
            home.path().join("owner.json"),
            r#"{"pid":1,"kind":"studio","socket":"ws://127.0.0.1:4747/","ready":false}"#,
        )
        .unwrap();
        assert_eq!(studio_address(home.path()), Err(NoStudio::NotReady));
        std::fs::write(
            home.path().join("owner.json"),
            r#"{"pid":1,"kind":"studio","socket":"ws://127.0.0.1:4747","ready":true}"#,
        )
        .unwrap();
        std::fs::write(home.path().join("session.token"), "abc\n").unwrap();
        let address = studio_address(home.path()).unwrap();
        assert_eq!(address.origin(), "http://127.0.0.1:4747");
        assert_eq!(address.url(), "ws://127.0.0.1:4747/?token=abc");
    }
}
