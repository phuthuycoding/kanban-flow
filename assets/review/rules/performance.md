# Performance Review Rules

## Evidence First
- Before applying a performance finding, name the path it sits on and how often it runs (per request, per row, at startup)
- A finding with no hot path and no measurement is LOW; do not ask for caching, memoization or indexes on a guess
- Correctness and readability win over an optimization nobody measured

## Queries & Data Access
- No N+1 queries (check for loops with DB calls inside)
- List endpoints and batch reads are bounded: pagination or an explicit limit
- A new query that filters or sorts on a column ships with the index it needs, or says why none is needed
- Prefer batch operations over one statement per row
- Select the columns the code uses; no whole-row fetch to read one field in a loop
- No transaction held open across a network call or user wait

## Network & I/O
- Independent I/O runs concurrently; concurrency over an unbounded list is capped
- Every external call has a timeout
- Retries are bounded and back off; no retry of a non-idempotent call without a key
- Connections come from a pool the process creates once, not per request

## Memory & CPU
- Stream large data instead of loading it into memory
- No nested scan of two unbounded collections (use a map or set for lookups)
- No blocking work on the event loop, the UI thread, or a request thread that could run elsewhere
- Listeners, timers and subscriptions are removed where they are added
- Clean up resources (close files, connections)

## Caching
- A cache names its key, its TTL and what invalidates it on mutation
- Caches and in-memory maps are bounded

## Frontend (if applicable)
- Non-critical code and assets load lazily; a new dependency states its bundle cost when it is large
- Lists that can grow are virtualized or paginated
- No request per keystroke without debounce or cancellation
- Images carry dimensions and an appropriate format; see the `frontend` stack pack for the rest
