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
- Uploads validated (MIME, extension, size) and stored outside web root or under renamed files
- CSRF tokens on state-changing requests; passwords via `password_hash`/`password_verify` only

## Dependencies & Config
- `composer.json`/`composer.lock` committed together; `composer audit` clean for new deps
- Deploy installs with `--no-dev` — no dev-only packages reachable in production
- Secrets and config from environment — nothing sensitive committed in `.env` or config files

## Performance
- No N+1 queries — eager loading/joins at the repository layer for loops over associations
- No `array_merge` or string concatenation inside loops over unbounded data
- No per-request filesystem scans or reflection recomputation in hot paths — cache at bootstrap
