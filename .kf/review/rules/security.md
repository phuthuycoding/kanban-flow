# Security Review Rules

## Threat Model First
- Before applying a security finding, state what the code stores, protects, and exposes
- Fix the real failure mode, not the abstract pattern — a finding without a reachable attack path is LOW
- Do not add auth/crypto/validation where the data is not sensitive and not externally reachable

## Secrets Management
- No hardcoded credentials, API keys, or tokens
- No secrets in workflow artifacts (specs, plans, reports) — `kf validate` rejects secret-like content
- Use environment variables or secret managers
- Never log sensitive data; mask it where a log line must carry the record

## Authentication & Authorization
- Check auth before business logic
- Every read or write of a record by id is scoped to the caller (owner, tenant, role) — an id from the request is never enough
- Use established auth patterns (not custom crypto); passwords only through the platform's password hash
- Enforce least-privilege access; a new endpoint or job states who may call it
- Tokens and session ids come from a cryptographic random source, expire, and are compared in constant time

## Input & Output
- Validate all external input at system boundary
- Use parameterized queries (no string concatenation for SQL)
- No user input in a shell command, a template source, or a dynamic code path (`eval`, dynamic import/include)
- Output is escaped for its context (HTML, attribute, URL, SQL, shell); raw-HTML escapes are justified in a comment
- File paths built from input are normalized and checked against an allowed root; uploads are checked for type and size and stored outside the served root
- A URL the server fetches on a caller's behalf is checked against an allowlist (no internal hosts or metadata addresses)
- Redirect targets taken from input are relative or allowlisted
- Untrusted bytes are never passed to a native deserializer (pickle, Marshal, Java serialization, `unserialize`)
- Incoming webhooks verify the sender's signature before any side effect
- State-changing requests from a browser carry CSRF protection

## Dependencies
- A new dependency is justified in the change, pinned or locked, and comes from the registry the project already uses
- No dependency fetched from a URL, a git branch, or a floating tag

## Data Protection
- Sensitive fields are not returned by default in API responses or serialized models
- Error responses do not leak stack traces, queries, or internal paths to the caller
- Public endpoints that are expensive or guessable (login, reset, search, upload) are rate limited
