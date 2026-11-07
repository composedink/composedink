//! One open post: its replica, the editor's draft, and typing the studio hasn't acknowledged.
//!
//! Order matters, and `poll` keeps it: local typing is folded into the replica first (any
//! difference between the draft and the replica at that moment is the person's), then studio
//! frames are imported, then any remaining difference is the studio's and is folded back into
//! the draft with the caret mapped across it.

use crate::link::Command;
use crate::replica::{Replica, splice};
use rune::TextEdit;
use std::collections::BTreeMap;
use std::ops::Range;

pub struct Post {
    pub id: String,
    replica: Replica,
    pub edit: TextEdit,
    /// Sent or unsent typing by sequence number, kept until the studio acknowledges it and sent
    /// again after every snapshot: a dropped socket or a lost acknowledgement loses nothing.
    pending: BTreeMap<u64, Vec<u8>>,
    seq: u64,
    /// The first snapshot has arrived; before it the draft is empty and read-only.
    pub loaded: bool,
    /// The socket is subscribed to this post and has answered with a snapshot.
    pub live: bool,
    pub error: Option<String>,
}

impl Post {
    pub fn new(id: impl Into<String>) -> Post {
        Post {
            id: id.into(),
            replica: Replica::new(),
            edit: TextEdit::new(""),
            pending: BTreeMap::new(),
            seq: 0,
            loaded: false,
            live: false,
            error: None,
        }
    }

    /// A post built from a replica (demo scenes and tests).
    pub fn from_replica(id: impl Into<String>, replica: Replica) -> Post {
        let mut post = Post::new(id);
        post.edit = TextEdit::new(replica.text());
        post.replica = replica;
        post.loaded = true;
        post
    }

    /// Fold the person's typing into the replica. The update is retained either way and returned
    /// for sending only while the studio is listening.
    pub fn push_local(&mut self) -> Option<Command> {
        if !self.loaded || self.edit.text == self.replica.text() {
            return None;
        }
        match self.replica.edit_to(&self.edit.text) {
            Ok(Some(bytes)) => {
                self.seq += 1;
                self.pending.insert(self.seq, bytes.clone());
                self.live.then(|| Command::Typing {
                    doc: self.id.clone(),
                    seq: self.seq,
                    bytes,
                })
            }
            Ok(None) => None,
            Err(e) => {
                self.error = Some(e);
                None
            }
        }
    }

    /// The studio's current state. Retained typing goes out again after it.
    pub fn snapshot(&mut self, bytes: &[u8]) -> Vec<Command> {
        if let Err(e) = self.replica.import(bytes) {
            self.error = Some(e);
            return Vec::new();
        }
        self.live = true;
        if self.loaded {
            self.reconcile();
        } else {
            self.edit = TextEdit::new(self.replica.text());
            self.edit.set_caret(body_start(&self.edit.text));
            self.edit.focused = true;
            self.loaded = true;
        }
        self.pending
            .iter()
            .map(|(&seq, bytes)| Command::Typing {
                doc: self.id.clone(),
                seq,
                bytes: bytes.clone(),
            })
            .collect()
    }

    pub fn update(&mut self, bytes: &[u8]) {
        match self.replica.import(bytes) {
            Ok(()) => self.reconcile(),
            Err(e) => self.error = Some(e),
        }
    }

    pub fn ack(&mut self, seq: u64) {
        self.pending.remove(&seq);
    }

    pub fn disconnected(&mut self) {
        self.live = false;
    }

    pub fn unsaved(&self) -> usize {
        self.pending.len()
    }

    /// The studio changed the text (normalization, an agent, another window): show its text and
    /// keep the caret on the same character.
    fn reconcile(&mut self) {
        let next = self.replica.text();
        let Some((range, insert)) = splice(&self.edit.text, &next) else {
            return;
        };
        let (anchor, focus) = (self.edit.anchor, self.edit.focus);
        let focused = self.edit.focused;
        let map = |at: usize| map_offset(at, &range, insert.len());
        // `replace_text` drops undo history: undo would otherwise step back over the studio's
        // change as if it were the person's.
        self.edit.replace_text(next.clone());
        self.edit.set_selection(map(anchor), map(focus));
        self.edit.focused = focused;
    }

    pub fn dim_ranges(&self) -> Vec<Range<usize>> {
        if self.edit.text == self.replica.text() {
            self.replica.dim_ranges()
        } else {
            Vec::new()
        }
    }

    /// The frontmatter `title`, else the id.
    pub fn title(&self) -> String {
        frontmatter(&self.edit.text)
            .and_then(|fm| fm.lines().find_map(|l| l.strip_prefix("title:")))
            .map(|t| t.trim().trim_matches(['"', '\'']).to_owned())
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| self.id.clone())
    }

    /// Words in the body (frontmatter excluded).
    pub fn words(&self) -> usize {
        self.edit.text[body_start(&self.edit.text)..]
            .split_whitespace()
            .count()
    }
}

/// Where `at` lands after `range` is replaced by `inserted` bytes.
fn map_offset(at: usize, range: &Range<usize>, inserted: usize) -> usize {
    if at <= range.start {
        at
    } else if at >= range.end {
        at - range.len() + inserted
    } else {
        range.start + inserted
    }
}

fn frontmatter(text: &str) -> Option<&str> {
    let rest = text.strip_prefix("---\n")?;
    rest.find("\n---").map(|end| &rest[..end])
}

/// The byte after the frontmatter block and the blank lines following it.
fn body_start(text: &str) -> usize {
    let Some(fm) = frontmatter(text) else {
        return 0;
    };
    let after = "---\n".len() + fm.len() + "\n---".len();
    after + text[after..].len() - text[after..].trim_start_matches('\n').len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use loro::ExportMode;

    const TEXT: &str = "---\ntitle: \"Rune client\"\n---\n\nOne two three.\n";

    fn studio() -> Replica {
        let mut r = Replica::new();
        r.edit_to(TEXT).unwrap();
        r
    }

    #[test]
    fn the_first_snapshot_loads_the_draft_with_the_caret_after_frontmatter() {
        let studio = studio();
        let mut post = Post::new("rune-client");
        assert!(
            post.snapshot(&studio.doc().export(ExportMode::Snapshot).unwrap())
                .is_empty()
        );
        assert!(post.loaded && post.live);
        assert_eq!(post.edit.text, TEXT);
        assert_eq!(&post.edit.text[post.edit.range().0..], "One two three.\n");
        assert_eq!(post.title(), "Rune client");
        assert_eq!(post.words(), 3);
    }

    #[test]
    fn typing_is_retained_until_acknowledged_and_resent_after_a_snapshot() {
        let mut studio = studio();
        let mut post = Post::new("p");
        post.snapshot(&studio.doc().export(ExportMode::Snapshot).unwrap());

        post.edit.text = TEXT.replace("three", "three four");
        let Some(Command::Typing { seq: 1, bytes, .. }) = post.push_local() else {
            panic!("typing goes out")
        };
        assert_eq!(post.unsaved(), 1);

        // The socket drops before the acknowledgement; more typing happens offline.
        post.disconnected();
        post.edit.text = TEXT.replace("three", "three four five");
        assert!(post.push_local().is_none(), "nothing is sent while offline");
        assert_eq!(post.unsaved(), 2);

        // Reconnect: the studio had imported the first update; the snapshot brings it back and
        // both retained updates go out again (importing an update twice is harmless).
        studio.import(&bytes).unwrap();
        let resend = post.snapshot(&studio.doc().export(ExportMode::Snapshot).unwrap());
        assert_eq!(resend.len(), 2);
        for command in resend {
            if let Command::Typing { bytes, .. } = command {
                studio.import(&bytes).unwrap();
            }
        }
        assert_eq!(studio.text(), post.edit.text);
        post.ack(1);
        post.ack(2);
        assert_eq!(post.unsaved(), 0);
    }

    #[test]
    fn a_studio_change_keeps_the_caret_on_the_same_character() {
        let mut studio = studio();
        let mut post = Post::new("p");
        post.snapshot(&studio.doc().export(ExportMode::Snapshot).unwrap());
        let before = studio.doc().oplog_vv();
        let caret = post.edit.text.find("three").unwrap();
        post.edit.set_caret(caret);

        // An agent inserts before the caret.
        studio
            .edit_to(&TEXT.replace("One two", "Zero one two"))
            .unwrap();
        post.update(&studio.doc().export(ExportMode::updates(&before)).unwrap());
        assert_eq!(post.edit.text, TEXT.replace("One two", "Zero one two"));
        assert_eq!(
            &post.edit.text[post.edit.range().0..post.edit.range().0 + 5],
            "three"
        );
    }

    #[test]
    fn offsets_map_across_a_replacement() {
        assert_eq!(map_offset(2, &(5..8), 1), 2);
        assert_eq!(map_offset(10, &(5..8), 1), 8);
        assert_eq!(map_offset(6, &(5..8), 1), 6);
    }
}
