//! The client's model and controller, kept apart from the view so they can be tested against a
//! real studio (`tests/studio.rs`). `main.rs` is the rune view over these.

pub mod home;
pub mod link;
pub mod post;
pub mod replica;
