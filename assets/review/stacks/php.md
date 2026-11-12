# PHP Review Rules

## Errors & Strictness
- `declare(strict_types=1)` at the top of every new file
- No `@` error suppression operator and no empty `catch` blocks — handle or rethrow
- Catch specific exception types; `Throwable` only at the application boundary handler
- Warnings/notices treated as bugs — no reliance on implicit null-to-type coercion

## Types & API
- Parameter, return, and property types declared — no `mixed` leaking past boundaries unvalidated
- Nullable contracts explicit (`?Type`); no silent `null` defaults where a value is required
- Enums and `readonly` used for fixed value sets and immutable data over loose arrays
- No `extract()`, variable-variables (`$$x`), or dynamic property access on user-controlled keys

## Security
- DB access via PDO prepared statements or ORM bindings — no string-concatenated SQL
- Output escaped for context (`htmlspecialchars`, template autoescape) — no raw `echo` of user data
- No `eval`, `unserialize` on untrusted input, or `include`/`require` of dynamic paths
- No user input in `exec`, `shell_exec`, `system`, `passthru`, `proc_open` or backticks — `escapeshellarg` at the least, an argument array where the API has one
- Hashes and tokens compared with `hash_equals`, never `==`; no loose `==` on values that decide access
- Session id regenerated on login and privilege change (`session_regenerate_id(true)`)
- No mass assignment from the whole request (`$request->all()`, an empty `$guarded`) — name the fields
- Uploads validated (MIME, extension, size) and stored outside web root or under renamed files
- CSRF tokens on state-changing requests; passwords via `password_hash`/`password_verify` only

## Dependencies & Config
- `composer.json`/`composer.lock` committed together (`composer audit` belongs in the project's verify commands)
- A package the production code imports is under `require`, never `require-dev`
- Secrets and config from environment — nothing sensitive committed in `.env` or config files

## Performance
- No N+1 queries — eager loading/joins at the repository layer for loops over associations
- No `array_merge` or string concatenation inside loops over unbounded data
- No per-request filesystem scans or reflection recomputation in hot paths — cache at bootstrap
