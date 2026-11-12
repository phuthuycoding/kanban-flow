# Python Review Rules

## Error Handling
- No bare `except:` or `except Exception: pass` — catch specific exception types only
- Exceptions re-raised or wrapped with `raise ... from e` preserving the original cause
- No exceptions used for control flow where a membership check or `.get()` is clearer
- Errors logged once at the layer with most context — no log-and-rethrow at every level

## Types & API
- Public functions have type hints; no `Any` leaking across module boundaries
- No mutable default arguments (`def f(x=[])`) — use `None` sentinel and init in body
- Dataclasses or typed models for structured data at boundaries, not raw dict bags
- No `*args/**kwargs` pass-through hiding the real signature on public APIs

## Concurrency
- No blocking calls (`time.sleep`, sync HTTP) inside `async def` — use awaitable equivalents
- Tasks/futures have a defined lifecycle — awaited, joined, or cancelled; no fire-and-forget
- Shared state guarded by locks or confined to one task; no unguarded mutation across threads

## Security
- SQL via parameterized queries or ORM bindings — no f-string or `%`-formatted SQL
- No `eval`/`exec`/`pickle.loads`/`yaml.load` on untrusted input (`yaml.safe_load` only)
- Subprocess calls use arg lists with `shell=False`; no user input in shell commands
- Secrets from env/vault only — nothing sensitive in code or committed config
- No `assert` for input validation or permission checks — it is stripped under `-O`
- No `verify=False` on TLS calls outside tests; paths built from input are resolved and checked against an allowed root

## Dependencies & Resources
- Files/sockets/connections managed with `with` — no unclosed `.open()` handles
- HTTP calls (`requests`, `httpx`, `urllib`) pass an explicit `timeout` — the default waits forever
- Timestamps are timezone-aware (`datetime.now(tz=…)`), never naive `datetime.now()` / `utcnow()`
- Lockfile committed (`requirements.txt`, `poetry.lock`, `uv.lock`) with pinned or bounded versions
- New dependencies justified — stdlib (pathlib, itertools, dataclasses) preferred first

## Performance
- No N+1 ORM queries — `select_related`/`prefetch_related`/batched fetches
- Membership tests in loops use `set`, not repeated `in` scans of a list
- Unbounded inputs streamed via generators — no `read()` of user-controlled size
