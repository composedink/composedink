//! The client's Loro replica of one post, the same role `loro-codemirror` plays for the web editor.
//!
//! Typing is spliced into the `mdx` text as the smallest byte-range change, committed, and handed
//! to the studio as an update; the authority imports it unchanged and normalizes in a follow-up
//! commit. Everything the authority commits (normalization, agent proposals, another client's
//! typing) comes back as updates and is imported here. The replica never runs operations.

use loro::{
    ExpandType, ExportMode, LoroDoc, LoroValue, StyleConfig, StyleConfigMap, TextDelta,
    VersionVector,
};
use std::ops::Range;

/// The post's text container (`KEYS.mdx` in core).
const MDX: &str = "mdx";
/// The dim mark (`model/marks.ts`); text you might cut, drawn faded.
const DIM: &str = "dim";

pub struct Replica {
    doc: LoroDoc,
    /// Everything already handed to the studio; the next update starts here.
    sent: VersionVector,
}

impl Default for Replica {
    fn default() -> Self {
        Self::new()
    }
}

impl Replica {
    pub fn new() -> Replica {
        let doc = LoroDoc::new();
        // Same as the authority: typing at a dim range's edge stays undimmed.
        let mut styles = StyleConfigMap::new();
        styles.insert(
            DIM.into(),
            StyleConfig {
                expand: ExpandType::None,
            },
        );
        doc.config_text_style(styles);
        let sent = doc.oplog_vv();
        Replica { doc, sent }
    }

    /// Import a snapshot or update from the studio. Its changes are the authority's, so the
    /// export point moves past them: they are never sent back.
    pub fn import(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.doc.import(bytes).map_err(|e| e.to_string())?;
        self.sent.merge(&self.doc.oplog_vv());
        Ok(())
    }

    pub fn text(&self) -> String {
        self.doc.get_text(MDX).to_string()
    }

    /// Make the replica's text equal `next` with one delete and one insert around the common
    /// prefix and suffix, and commit. Returns the update to send, or `None` when nothing changed.
    pub fn edit_to(&mut self, next: &str) -> Result<Option<Vec<u8>>, String> {
        let current = self.text();
        let Some((range, insert)) = splice(&current, next) else {
            return Ok(None);
        };
        let text = self.doc.get_text(MDX);
        if !range.is_empty() {
            text.delete_utf8(range.start, range.len())
                .map_err(|e| e.to_string())?;
        }
        if !insert.is_empty() {
            text.insert_utf8(range.start, insert)
                .map_err(|e| e.to_string())?;
        }
        self.doc.commit();
        self.take_update()
    }

    /// Local changes since the last send, as one update, or `None` when there are none.
    fn take_update(&mut self) -> Result<Option<Vec<u8>>, String> {
        let now = self.doc.oplog_vv();
        if now == self.sent {
            return Ok(None);
        }
        let bytes = self
            .doc
            .export(ExportMode::updates(&self.sent))
            .map_err(|e| e.to_string())?;
        self.sent = now;
        Ok(Some(bytes))
    }

    /// Byte ranges of `text()` under the dim mark, in order.
    pub fn dim_ranges(&self) -> Vec<Range<usize>> {
        let mut ranges: Vec<Range<usize>> = Vec::new();
        let mut at = 0;
        for delta in self.doc.get_text(MDX).to_delta() {
            let TextDelta::Insert { insert, attributes } = delta else {
                continue;
            };
            let end = at + insert.len();
            let dim = attributes
                .as_ref()
                .and_then(|a| a.get(DIM))
                .is_some_and(|v| !matches!(v, LoroValue::Null | LoroValue::Bool(false)));
            if dim {
                match ranges.last_mut() {
                    Some(last) if last.end == at => last.end = end,
                    _ => ranges.push(at..end),
                }
            }
            at = end;
        }
        ranges
    }

    /// Dim a byte range of `text()` (demo scenes; the studio owns dimming through `ghost.set`).
    pub fn dim_bytes(&mut self, range: Range<usize>) {
        let text = self.text();
        let start = text[..range.start].chars().count();
        let end = start + text[range].chars().count();
        let _ = self.doc.get_text(MDX).mark(start..end, DIM, true);
        self.doc.commit();
        self.sent = self.doc.oplog_vv();
    }

    /// The underlying document (tests build studio-side replicas with it).
    pub fn doc(&self) -> &LoroDoc {
        &self.doc
    }
}

/// The byte range of `from` to replace and the text to put there so it becomes `to`, or `None`
/// when they are equal. Prefix and suffix stop on character boundaries of both strings.
pub fn splice<'a>(from: &str, to: &'a str) -> Option<(Range<usize>, &'a str)> {
    if from == to {
        return None;
    }
    let mut prefix = from
        .bytes()
        .zip(to.bytes())
        .take_while(|(a, b)| a == b)
        .count();
    while !from.is_char_boundary(prefix) || !to.is_char_boundary(prefix) {
        prefix -= 1;
    }
    let room = from.len().min(to.len()) - prefix;
    let mut suffix = from
        .bytes()
        .rev()
        .zip(to.bytes().rev())
        .take(room)
        .take_while(|(a, b)| a == b)
        .count();
    while !from.is_char_boundary(from.len() - suffix) || !to.is_char_boundary(to.len() - suffix) {
        suffix -= 1;
    }
    Some((prefix..from.len() - suffix, &to[prefix..to.len() - suffix]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splice_finds_the_smallest_change_on_char_boundaries() {
        assert_eq!(splice("same", "same"), None);
        assert_eq!(
            splice("hello world", "hello brave world"),
            Some((6..6, "brave "))
        );
        assert_eq!(
            splice("hello brave world", "hello world"),
            Some((6..12, ""))
        );
        assert_eq!(splice("cat", "cut"), Some((1..2, "u")));
        // "é" and "è" share their first UTF-8 byte; the change must cover the whole character.
        assert_eq!(splice("café", "cafè"), Some((3..5, "è")));
        // Repeated letters: the suffix may not overlap the prefix.
        assert_eq!(splice("aa", "aaa"), Some((2..2, "a")));
        assert_eq!(splice("", "new"), Some((0..0, "new")));
    }

    #[test]
    fn edits_round_trip_to_another_replica_as_updates() {
        let mut studio = Replica::new();
        studio
            .edit_to("---\ntitle: Post\n---\n\nFirst draft.\n")
            .unwrap();
        let snapshot = studio.doc().export(ExportMode::Snapshot).unwrap();

        let mut client = Replica::new();
        client.import(&snapshot).unwrap();
        assert_eq!(client.text(), studio.text());
        assert!(
            client.edit_to(&client.text()).unwrap().is_none(),
            "imported text is not resent"
        );

        let update = client
            .edit_to("---\ntitle: Post\n---\n\nFirst rough draft — ünïcode.\n")
            .unwrap()
            .unwrap();
        studio.import(&update).unwrap();
        assert_eq!(studio.text(), client.text());
        assert!(
            client.edit_to(&client.text()).unwrap().is_none(),
            "nothing left to send"
        );
    }

    #[test]
    fn concurrent_edits_converge() {
        let mut a = Replica::new();
        a.edit_to("one two three").unwrap();
        let mut b = Replica::new();
        b.import(&a.doc().export(ExportMode::Snapshot).unwrap())
            .unwrap();
        let from_a = a.edit_to("one two three four").unwrap().unwrap();
        let from_b = b.edit_to("zero one two three").unwrap().unwrap();
        a.import(&from_b).unwrap();
        b.import(&from_a).unwrap();
        assert_eq!(a.text(), "zero one two three four");
        assert_eq!(a.text(), b.text());
    }

    #[test]
    fn dim_ranges_are_byte_ranges_of_the_dim_mark() {
        let mut studio = Replica::new();
        studio
            .edit_to("Keep this. Maybe cut — this. Keep.")
            .unwrap();
        let text = studio.doc().get_text(MDX);
        // Loro marks take Unicode scalar positions: "Maybe cut — this." is chars 11..28.
        text.mark(11..28, DIM, true).unwrap();
        studio.doc().commit();
        let mut client = Replica::new();
        client
            .import(&studio.doc().export(ExportMode::Snapshot).unwrap())
            .unwrap();
        let dims = client.dim_ranges();
        assert_eq!(dims.len(), 1);
        assert_eq!(&client.text()[dims[0].clone()], "Maybe cut — this.");
    }
}
