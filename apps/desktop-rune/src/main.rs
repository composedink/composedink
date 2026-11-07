//! composed, drawn natively with rune.
//!
//! A minimum viable client of the studio: list posts, open one, write in it, and see the
//! studio's changes (normalization, agent proposals, other windows) arrive live. It is a peer of
//! the web editor on the same socket and protocol; the studio stays the only writer of the store.
//!
//! `cargo run` opens the window against `$COMPOSED_HOME` (default `~/.composed`).
//! `cargo run -- --snap shot.png --scene draft` renders the demo scene headless, no studio.

use composed_rune::home::{composed_home, list_posts};
use composed_rune::link::{Command, Event, Link};
use composed_rune::post::Post;
use composed_rune::replica;
use rune::tok::{self, type_};
use rune::{
    AppSpec, Color, Cx, El, ScrollSpec, Span, TextEdit, TextStyle, Tx, Waker, col, el, row, spacer,
    text, text_input,
};
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;

pub struct State {
    home: PathBuf,
    posts: Vec<String>,
    open: Option<Post>,
    link: Option<Link>,
    connected: bool,
    /// Why there is no studio, as the fix to type (`fix: composed studio`).
    offline: Option<String>,
    notice: Option<String>,
    new_slug: TextEdit,
    /// Operation request ids; the only one this client makes is `doc.create`.
    request: u64,
    creating: Option<(u64, String)>,
    /// Bound by `text_input` when no post is open, so `on_edit` always has a target.
    scratch: TextEdit,
    dark: bool,
    /// Rescan `$COMPOSED_HOME/docs` for posts made elsewhere; demo scenes turn it off.
    watch_home: bool,
}

fn init() -> State {
    let home = composed_home();
    State {
        posts: list_posts(&home),
        home,
        open: None,
        link: None,
        connected: false,
        offline: None,
        notice: None,
        new_slug: TextEdit::new(""),
        request: 0,
        creating: None,
        scratch: TextEdit::new(""),
        dark: true,
        watch_home: true,
    }
}

impl State {
    fn send(&self, command: Command) {
        if let Some(link) = &self.link {
            link.send(command);
        }
    }

    fn open_post(&mut self, id: &str) {
        if self.open.as_ref().is_some_and(|p| p.id == id) {
            return;
        }
        self.open = Some(Post::new(id));
        self.send(Command::Open(id.to_owned()));
    }

    fn create_post(&mut self) {
        let slug = self.new_slug.text.trim().to_owned();
        if slug.is_empty() || self.creating.is_some() {
            return;
        }
        self.request += 1;
        self.creating = Some((self.request, slug.clone()));
        self.send(Command::Call {
            request: self.request,
            name: "doc.create".into(),
            input: json!({ "slug": slug, "kind": "post" }),
        });
    }

    /// Start `composed studio --headless` for this home. `COMPOSED_CLI` names the CLI when it
    /// isn't on PATH (in the repo: `apps/cli/bin/composed`, run under `mise exec`).
    fn start_studio(&mut self) {
        let cli = std::env::var("COMPOSED_CLI").unwrap_or_else(|_| "composed".into());
        let started = std::process::Command::new(&cli)
            .args(["studio", "--headless"])
            .env("COMPOSED_HOME", &self.home)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
        self.notice = Some(match started {
            Ok(_) => "Starting studio…".into(),
            Err(e) => format!("Couldn't run `{cli} studio --headless`: {e}. Set COMPOSED_CLI."),
        });
    }
}

/// The controller: runs before every frame. Local typing first, then studio frames, then the
/// post list. True when the view must be rebuilt.
fn poll(s: &mut State, _clock: f64, tx: &mut Tx) -> bool {
    let mut changed = false;
    if let Some(post) = s.open.as_mut()
        && let Some(command) = post.push_local()
    {
        s.send(command);
        changed = true;
    }
    let events: Vec<Event> = s
        .link
        .as_ref()
        .map(|l| l.events.try_iter().collect())
        .unwrap_or_default();
    for event in events {
        changed = true;
        match event {
            Event::Connected => {
                s.connected = true;
                s.offline = None;
            }
            Event::Disconnected(reason) => {
                s.connected = false;
                s.offline = Some(reason);
                if let Some(post) = s.open.as_mut() {
                    post.disconnected();
                }
            }
            Event::Snapshot { doc, bytes } => {
                if let Some(post) = s.open.as_mut().filter(|p| p.id == doc) {
                    for command in post.snapshot(&bytes) {
                        s.send(command);
                    }
                }
            }
            Event::Update { doc, bytes } => {
                if let Some(post) = s.open.as_mut().filter(|p| p.id == doc) {
                    post.update(&bytes);
                }
            }
            Event::Ack { doc, seq } => {
                if let Some(post) = s.open.as_mut().filter(|p| p.id == doc) {
                    post.ack(seq);
                }
            }
            Event::Reply { request, result } => {
                if let Some((_, slug)) = s.creating.take_if(|(r, _)| *r == request) {
                    match result {
                        Ok(_) => {
                            s.new_slug.clear();
                            s.posts = list_posts(&s.home);
                            s.open_post(&slug);
                            s.notice = None;
                        }
                        Err(e) => s.notice = Some(e),
                    }
                }
            }
            Event::Notice(message) => s.notice = Some(message),
        }
    }
    // The studio writes new posts from anywhere (CLI, agents); look again now and then.
    if !s.watch_home {
        return changed;
    }
    tx.wake_after(Duration::from_secs(2));
    let posts = list_posts(&s.home);
    if posts != s.posts {
        s.posts = posts;
        changed = true;
    }
    changed
}

fn setup(s: &mut State, wake: Waker) {
    if headless() {
        return;
    }
    s.link = Some(Link::spawn(s.home.clone(), wake));
}

/// Rendering a snapshot or trace: no window, so no studio connection either.
fn headless() -> bool {
    std::env::args().any(|a| {
        matches!(
            a.as_str(),
            "--snap" | "--trace" | "--tree" | "--frames" | "--strip" | "--list-scenes"
        )
    })
}

/// Prose measure: about 75 characters at the body size.
const MEASURE: f32 = 760.0;
const PROSE: TextStyle = TextStyle::new(16.0, 400.0).lh(26.0);

fn view(s: &State, _: &mut Cx<State>) -> El {
    let t = tok::theme(s.dark);
    row()
        .w_full()
        .h_full()
        .fill(t.bg)
        .child(sidebar(s, &t))
        .child(main_pane(s, &t))
}

fn sidebar(s: &State, t: &tok::Theme) -> El {
    let mut list = col().gap(2.0).w_full();
    for id in &s.posts {
        let selected = s.open.as_ref().is_some_and(|p| &p.id == id);
        let id_owned = id.clone();
        list = list.child(
            el().key(format!("post:{id}"))
                .role("button")
                .label(id.as_str())
                .focusable(true)
                .w_full()
                .padding(8.0)
                .radius(6.0)
                .fill(if selected {
                    t.press
                } else {
                    Color::TRANSPARENT
                })
                .on_press(move |s: &mut State| s.open_post(&id_owned))
                .child(
                    text(id.as_str())
                        .font(type_::BODY)
                        .color(if selected { t.text } else { t.text_secondary })
                        .truncate(),
                ),
        );
    }
    if s.posts.is_empty() {
        list = list.child(
            text("No posts yet")
                .font(type_::BODY)
                .color(t.text_secondary),
        );
    }
    let new_post = col()
        .gap(6.0)
        .w_full()
        .child(
            text("New post")
                .font(type_::SECTION)
                .color(t.text_secondary),
        )
        .child(
            el().w_full()
                .padding(6.0)
                .radius(6.0)
                .border(1.0, t.separator)
                .child(
                    text_input(&s.new_slug, type_::BODY)
                        .key("new-slug")
                        .single_line()
                        .placeholder("slug-for-the-post", t.text_secondary)
                        .on_edit(|s: &mut State| &mut s.new_slug)
                        .on_submit(|s: &mut State, _| s.create_post())
                        .w_full(),
                ),
        )
        .child(button("create", "Create", t, |s: &mut State| {
            s.create_post()
        }));
    col()
        .key("sidebar")
        .w(240.0)
        .h_full()
        .min_h(0.0)
        .padding(14.0)
        .gap(14.0)
        .fill(t.card)
        .child(text("composed").font(type_::TITLE).color(t.text))
        .child(
            col()
                .key("posts")
                .grow(1.0)
                .min_h(0.0)
                .w_full()
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .child(list),
        )
        .child(new_post)
}

fn main_pane(s: &State, t: &tok::Theme) -> El {
    let body = match &s.open {
        Some(post) if post.loaded => {
            let dims: Vec<Span> = post
                .dim_ranges()
                .into_iter()
                .map(|r| Span::new(r.start, r.end).color(t.text_secondary))
                .collect();
            let editor = text_input(&post.edit, PROSE)
                .key("editor")
                .label("Post source")
                .on_edit(|s: &mut State| match s.open.as_mut() {
                    Some(post) => &mut post.edit,
                    None => &mut s.scratch,
                })
                .decorations(dims)
                .color(t.text)
                .w_full();
            col()
                .key("page")
                .w_full()
                .max_w(MEASURE)
                .padding(40.0)
                .gap(18.0)
                .child(
                    text(post.title())
                        .font(TextStyle::new(24.0, 650.0))
                        .color(t.text),
                )
                .child(editor)
        }
        Some(_) => centered(t, "Opening…"),
        None => centered(t, "Pick a post, or start a new one."),
    };
    col()
        .key("main")
        .grow(1.0)
        .h_full()
        .min_h(0.0)
        .child(
            col()
                .key("scroll")
                .grow(1.0)
                .min_h(0.0)
                .w_full()
                .items_center()
                .scroll(ScrollSpec {
                    stick_bottom: false,
                })
                .child(body),
        )
        .child(status_bar(s, t))
}

fn status_bar(s: &State, t: &tok::Theme) -> El {
    let save = match (&s.open, s.connected) {
        (_, false) => s.offline.clone().unwrap_or_else(|| "Connecting…".into()),
        (Some(post), true) if post.error.is_some() => {
            format!("Unsaved — {}", post.error.as_deref().unwrap_or(""))
        }
        (Some(post), true) if post.unsaved() > 0 => "Saving…".into(),
        (Some(_), true) => "Saved".into(),
        (None, true) => "Connected".into(),
    };
    let mut bar = row()
        .key("status")
        .w_full()
        .padding(10.0)
        .gap(14.0)
        .fill(t.card)
        .child(text(save).font(type_::LABEL).color(t.text_secondary));
    if !s.connected
        && s.offline
            .as_deref()
            .is_some_and(|r| r.contains("composed studio"))
    {
        bar = bar.child(button(
            "start-studio",
            "Start studio",
            t,
            |s: &mut State| s.start_studio(),
        ));
    }
    if let Some(notice) = &s.notice {
        bar = bar.child(
            text(notice.as_str())
                .font(type_::LABEL)
                .color(t.text_secondary)
                .truncate()
                .shrink(),
        );
    }
    bar = bar.child(spacer());
    if let Some(post) = s.open.as_ref().filter(|p| p.loaded) {
        bar = bar.child(
            text(format!("{} words", post.words()))
                .font(type_::LABEL)
                .color(t.text_secondary),
        );
    }
    bar
}

fn centered(t: &tok::Theme, message: &str) -> El {
    col()
        .w_full()
        .padding(80.0)
        .center()
        .child(text(message).font(type_::BODY).color(t.text_secondary))
}

fn button(key: &str, label: &str, t: &tok::Theme, press: impl Fn(&mut State) + 'static) -> El {
    el().key(key)
        .role("button")
        .label(label)
        .focusable(true)
        .padding(6.0)
        .radius(6.0)
        .fill(t.control_off)
        .center()
        .on_press(press)
        .child(text(label).font(type_::LABEL).color(t.text))
}

/// A post with a dimmed sentence, for headless snapshots without a studio.
fn draft(s: &mut State) {
    let mut replica = replica::Replica::new();
    let source = "---\ntitle: \"Writing in rune\"\n---\n\nThis paragraph is the keeper. It says one thing and stops. This sentence might go; it is dimmed, not deleted.\n\nAlternatives, threads and lint arrive in later slices.\n";
    let _ = replica.edit_to(source);
    let dim = source.find("This sentence").unwrap();
    replica.dim_bytes(dim..source.find(" deleted.").unwrap() + " deleted.".len());
    s.watch_home = false;
    s.posts = vec!["another-post".into(), "writing-in-rune".into()];
    s.open = Some(Post::from_replica("writing-in-rune", replica));
    s.connected = true;
}

fn main() {
    rune::run(AppSpec::<State> {
        scenes: &[
            ("draft", draft),
            ("light", |s| {
                draft(s);
                s.dark = false;
            }),
        ],
        setup: Some(setup),
        poll: Some(poll),
        ..AppSpec::new("composed", (1040.0, 720.0), init, view)
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use rune::{Env, Key, KeyEvent, Mods, Runtime};

    #[test]
    fn typing_in_the_editor_goes_into_the_replica() {
        let env = Env {
            system_dark: true,
            scale: 2.0,
        };
        let mut s = init();
        draft(&mut s);
        let mut rt = Runtime::new(s, view, (1040.0, 720.0), env);
        rt.poll = Some(poll);
        rt.frame(0.0);
        let (x, y) = rt.find("editor").expect("the editor is on screen");
        rt.pointer_down(x, y);
        rt.pointer_up(x, y);
        rt.frame(1.0 / 60.0);
        rt.key(KeyEvent {
            key: Key::Text("!".into()),
            mods: Mods::default(),
        });
        for _ in 0..3 {
            rt.frame(1.0 / 60.0);
        }
        let post = rt.state.open.as_ref().unwrap();
        assert!(
            post.edit.text.contains('!'),
            "the keystroke reached the draft"
        );
        assert_eq!(
            post.unsaved(),
            1,
            "and became one retained update for the studio"
        );
        assert_eq!(
            post.words(),
            28,
            "the demo body has 28 words; the `!` joins one"
        );
    }
}
