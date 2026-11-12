# Java Review Rules

## Error Handling
- No empty `catch` blocks and no `catch (Exception e)` that swallows — handle or rethrow with cause
- Wrapped exceptions preserve the original via the `cause` constructor — no lost stack traces
- No `throws Exception`/`Throwable` on public APIs — declare specific exception types
- Exceptions not used for expected control flow; `Optional`/empty results for normal absence

## Null Safety & API
- `null` never returned where `Optional` or an empty collection expresses absence
- Nullability contracts explicit (`@Nullable`/`Objects.requireNonNull`) at public boundaries
- `equals`/`hashCode` implemented together or via records/Lombok — never one without the other
- Reference comparison with `equals`, never `==` on Strings or boxed types
- Immutability preferred — `final` fields, `List.copyOf` on returns, records for value types

## Resources & Concurrency
- Try-with-resources for every `AutoCloseable` — no manual `close()` in `finally`
- Shared mutable state guarded (locks, concurrent collections) — no unsynchronized lazy init
- `ExecutorService` over raw `Thread`; pools are sized, named, and shut down on lifecycle end
- Interrupted status restored (`Thread.currentThread().interrupt()`) or propagated, not swallowed
- No `Future.get()` without a timeout on blocking waits

## Security
- JDBC via `PreparedStatement`/parameterized APIs — no string-concatenated SQL
- No Java native deserialization (`ObjectInputStream`) of untrusted bytes
- `Runtime.exec`/`ProcessBuilder` never interpolate user input into commands
- File paths validated against traversal (`normalize` + root check) before access

## Dependencies & Build
- `pom.xml`/`build.gradle` changes reviewed — versions pinned, scopes correct, no unused deps
- No SNAPSHOT versions on release branches; wrapper scripts kept consistent with the build
- Secrets and environment config externalized — nothing sensitive in committed properties/YAML

## Performance
- No N+1 via JPA — entity graphs/`JOIN FETCH`/batch fetching for associations in loops
- `StringBuilder` for concatenation in loops — no `+` on hot paths
- No boxing (`Integer`/`Long`) in hot loops where primitives suffice
- Caches and pools bounded with eviction configured — no unbounded map-as-cache
