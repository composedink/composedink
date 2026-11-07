//! The studio socket, on its own thread.
//!
//! Frames are the web editor's (`apps/web/src/editor/transport.ts`):
//! - out: `{subscribe, session}` opens a document; `{doc, bytes, seq}` is typing (a Loro update,
//!   base64); `{request, name, input, human: true}` runs an operation as the person at this
//!   window (the token-gated socket is the studio's own client, as the web editor is).
//! - in: `{doc, snapshot, head}` answers a subscribe; `{doc, bytes}` is a commit to that
//!   document; `{doc, seq, ..}` acknowledges typing; `{request, result | error}` answers an
//!   operation; `{preview}` and `{config}` are notices.
//!
//! The thread never holds document state. Typing that has not been acknowledged is retained by
//! the caller and sent again after the next snapshot, so a dropped socket loses nothing.

use crate::home::{NoStudio, StudioAddress, studio_address};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde_json::{Value, json};
use std::io::ErrorKind;
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender, TryRecvError, channel};
use std::time::Duration;
use tungstenite::client::IntoClientRequest;
use tungstenite::http::HeaderValue;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

pub enum Command {
    Open(String),
    Typing {
        doc: String,
        seq: u64,
        bytes: Vec<u8>,
    },
    Call {
        request: u64,
        name: String,
        input: Value,
    },
}

#[derive(Debug)]
pub enum Event {
    Connected,
    Disconnected(String),
    Snapshot {
        doc: String,
        bytes: Vec<u8>,
    },
    Update {
        doc: String,
        bytes: Vec<u8>,
    },
    Ack {
        doc: String,
        seq: u64,
    },
    Reply {
        request: u64,
        result: Result<Value, String>,
    },
    Notice(String),
}

pub type Wake = std::sync::Arc<dyn Fn() + Send + Sync>;

/// The UI's end: send commands, drain events in `poll`.
pub struct Link {
    commands: Sender<Command>,
    pub events: Receiver<Event>,
}

impl Link {
    pub fn spawn(home: PathBuf, wake: Wake) -> Link {
        let (commands, inbox) = channel();
        let (outbox, events) = channel();
        std::thread::Builder::new()
            .name("composed-studio-link".into())
            .spawn(move || run(home, inbox, outbox, wake))
            .expect("spawn studio link thread");
        Link { commands, events }
    }

    pub fn send(&self, command: Command) {
        // The thread only exits when this end is dropped, so a failed send can't happen while
        // the window is open.
        let _ = self.commands.send(command);
    }
}

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;

fn run(home: PathBuf, inbox: Receiver<Command>, outbox: Sender<Event>, wake: Wake) {
    let emit = |event: Event| {
        let _ = outbox.send(event);
        wake();
    };
    let mut open: Option<String> = None;
    let mut last_reason: Option<String> = None;
    loop {
        let address = match studio_address(&home) {
            Ok(address) => address,
            Err(reason) => {
                if !wait_offline(&inbox, &mut open, &emit, reason.fix(), &mut last_reason) {
                    return;
                }
                continue;
            }
        };
        let mut socket = match connect(&address) {
            Ok(socket) => socket,
            Err(_) => {
                if !wait_offline(
                    &inbox,
                    &mut open,
                    &emit,
                    NoStudio::NotRunning.fix(),
                    &mut last_reason,
                ) {
                    return;
                }
                continue;
            }
        };
        last_reason = None;
        emit(Event::Connected);
        if let Some(doc) = &open {
            let _ = socket.send(subscribe(doc));
        }
        match session(&mut socket, &inbox, &mut open, &emit) {
            Ended::Closed => return,
            Ended::Dropped(reason) => emit(Event::Disconnected(reason)),
        }
    }
}

/// Wait for the studio to come back while still taking commands: the last `Open` wins, typing is
/// dropped (the caller retains it), operations fail at once. False when the window went away.
fn wait_offline(
    inbox: &Receiver<Command>,
    open: &mut Option<String>,
    emit: &impl Fn(Event),
    reason: &str,
    last_reason: &mut Option<String>,
) -> bool {
    if last_reason.as_deref() != Some(reason) {
        emit(Event::Disconnected(reason.to_owned()));
        *last_reason = Some(reason.to_owned());
    }
    match inbox.recv_timeout(Duration::from_millis(400)) {
        Ok(Command::Open(doc)) => *open = Some(doc),
        Ok(Command::Typing { .. }) => {}
        Ok(Command::Call { request, .. }) => emit(Event::Reply {
            request,
            result: Err("Studio isn't connected".into()),
        }),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return false,
    }
    true
}

fn connect(address: &StudioAddress) -> Result<Socket, String> {
    let mut request = address
        .url()
        .into_client_request()
        .map_err(|e| e.to_string())?;
    let origin = HeaderValue::from_str(&address.origin()).map_err(|e| e.to_string())?;
    request.headers_mut().insert("Origin", origin);
    let (socket, _) = tungstenite::connect(request).map_err(|e| e.to_string())?;
    if let MaybeTlsStream::Plain(stream) = socket.get_ref() {
        // Short reads let one thread both listen and forward commands.
        stream
            .set_read_timeout(Some(Duration::from_millis(15)))
            .map_err(|e| e.to_string())?;
        stream.set_nodelay(true).map_err(|e| e.to_string())?;
    }
    Ok(socket)
}

enum Ended {
    Closed,
    Dropped(String),
}

fn session(
    socket: &mut Socket,
    inbox: &Receiver<Command>,
    open: &mut Option<String>,
    emit: &impl Fn(Event),
) -> Ended {
    loop {
        loop {
            let frame = match inbox.try_recv() {
                Ok(Command::Open(doc)) => {
                    let frame = subscribe(&doc);
                    *open = Some(doc);
                    frame
                }
                Ok(Command::Typing { doc, seq, bytes }) => Message::text(
                    json!({ "doc": doc, "bytes": B64.encode(bytes), "seq": seq }).to_string(),
                ),
                Ok(Command::Call {
                    request,
                    name,
                    input,
                }) => Message::text(
                    json!({ "request": request, "name": name, "input": input, "human": true })
                        .to_string(),
                ),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    let _ = socket.close(None);
                    return Ended::Closed;
                }
            };
            if let Err(e) = socket.send(frame) {
                return Ended::Dropped(format!("Studio connection lost: {e}"));
            }
        }
        match socket.read() {
            Ok(Message::Text(text)) => {
                for event in parse(&text) {
                    emit(event);
                }
            }
            Ok(Message::Close(_)) => return Ended::Dropped("Studio closed the connection".into()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e))
                if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(e) => return Ended::Dropped(format!("Studio connection lost: {e}")),
        }
    }
}

fn subscribe(doc: &str) -> Message {
    Message::text(json!({ "subscribe": doc }).to_string())
}

/// One studio frame as the events it carries (an acknowledgement can arrive with an update).
pub fn parse(text: &str) -> Vec<Event> {
    let Ok(frame) = serde_json::from_str::<Value>(text) else {
        return Vec::new();
    };
    let mut events = Vec::new();
    if let Some(request) = frame.get("request").and_then(Value::as_u64) {
        let result = match frame.get("error").and_then(Value::as_str) {
            Some(error) => Err(error.to_owned()),
            None => Ok(frame.get("result").cloned().unwrap_or(Value::Null)),
        };
        events.push(Event::Reply { request, result });
        return events;
    }
    if let Some(error) = frame.get("error").and_then(Value::as_str) {
        events.push(Event::Notice(error.to_owned()));
        return events;
    }
    if frame.get("preview").is_some() {
        events.push(Event::Notice("Preview updated".into()));
        return events;
    }
    let Some(doc) = frame.get("doc").and_then(Value::as_str).map(str::to_owned) else {
        return events;
    };
    let decode = |key: &str| {
        frame
            .get(key)
            .and_then(Value::as_str)
            .and_then(|b| B64.decode(b).ok())
    };
    if let Some(bytes) = decode("snapshot") {
        events.push(Event::Snapshot {
            doc: doc.clone(),
            bytes,
        });
    } else if let Some(bytes) = decode("bytes") {
        events.push(Event::Update {
            doc: doc.clone(),
            bytes,
        });
    }
    if let Some(seq) = frame.get("seq").and_then(Value::as_u64) {
        events.push(Event::Ack { doc, seq });
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_parse_into_events() {
        let snapshot = parse(r#"{"doc":"p","snapshot":"AQID","head":"x"}"#);
        assert!(
            matches!(&snapshot[..], [Event::Snapshot { doc, bytes }] if doc == "p" && bytes == &[1, 2, 3])
        );
        let update = parse(r#"{"doc":"p","bytes":"AQ=="}"#);
        assert!(matches!(&update[..], [Event::Update { bytes, .. }] if bytes == &[1]));
        let ack = parse(r#"{"doc":"p","seq":4,"ok":true}"#);
        assert!(matches!(&ack[..], [Event::Ack { seq: 4, .. }]));
        let reply = parse(r#"{"request":2,"result":{"id":"p"}}"#);
        assert!(matches!(
            &reply[..],
            [Event::Reply {
                request: 2,
                result: Ok(_)
            }]
        ));
        let failed = parse(r#"{"request":3,"error":"Error: DocumentExists"}"#);
        assert!(
            matches!(&failed[..], [Event::Reply { request: 3, result: Err(e) }] if e.contains("DocumentExists"))
        );
        assert!(parse("not json").is_empty());
    }
}
