# Rust Review Rules

## Error Handling
- No `.unwrap()` / `.expect()` outside tests and `main` — propagate with `?` or map to typed errors
- Library crates expose typed errors (`thiserror` or manual enum); `anyhow` only at the binary/application edge
- No silently dropped `Result` — `let _ =` on a `Result` requires a comment why it is safe
- Panics never cross the public API as a control-flow mechanism

## Safety
- `unsafe` blocks are minimal, justified by a `// SAFETY:` comment, and reviewed individually
- No `unsafe` to work around ownership — restructure instead
- `clippy::pedantic`-level warnings justified or fixed; `cargo clippy` and `cargo fmt --check` clean
- No integer overflow risk on user input — use `checked_`/`saturating_` ops where values are untrusted

## Ownership & API Design
- Prefer borrowing (`&T`, `&mut T`) over `.clone()` in hot paths; clones must be justified
- Public types own their invariants — invalid states are unrepresentable (newtypes, enums), not validated per call
- `#[must_use]` on Results/values whose discard is a bug; `Drop` types clean up on all paths
- No `Rc`/`RefCell`/`Arc<Mutex>` leaks into API signatures without reason — keep them internal

## Concurrency
- Shared state via `Arc<Mutex>`/`RwLock` or channels — no `static mut`, no lazy globals with mutation
- `Send`/`Sync` bounds are correct, not circumvented; async tasks have a defined join/abort path
- Lock scope is minimal — no `.await` while holding a `Mutex` guard (use `tokio::sync` primitives in async)

## Dependencies & Code Quality
- `Cargo.lock` committed for binaries; dependency features reviewed — no default-features pulled blindly
- No `.unwrap()` on env/config parsing at runtime — fail fast with context at startup
- Tests live in `#[cfg(test)]` modules or `tests/`; doc examples compile via `cargo test --doc`

## Performance
- No accidental quadratic copies — `&str` slices, iterators, `Vec::with_capacity`
- Serialization/deserialization derives are explicit; no `serde_json::Value` bags in hot paths
