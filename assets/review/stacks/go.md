# Go Review Rules

## Error Handling
- No ignored errors — every `err` is checked, wrapped with `%w` context, or explicitly documented why safe
- No `panic` in library code; reserve for truly unrecoverable startup failures
- Error return is the last return value; sentinel errors via `errors.Is`/`errors.As`, not `==` on messages
- No empty `if err != nil {}` blocks and no `_ =` discarding of meaningful errors

## Concurrency
- Every goroutine has a defined lifecycle — no fire-and-forget without a stop/join path
- Shared state guarded by mutex/channel, never by convention (the race detector belongs in the project's verify commands, not in a review claim)
- Channels closed by the sender only; no send on possibly-closed channel
- `context.Context` is the first parameter and propagates cancellation — no `context.Background()` deep in call chains

## Resources
- `defer x.Close()` immediately after successful open/conn/resp — before the error return path
- HTTP response bodies always drained and closed
- No goroutine leaks via unbounded blocking writes — use buffered channels or select+ctx
- No `defer` inside a loop that runs many iterations — close in the loop body or a helper
- `http.Client` and `http.Server` set explicit timeouts; the zero value waits forever

## Code Quality
- Exported symbols have doc comments starting with the symbol name
- Interfaces defined at the consumer, small (1-3 methods); no giant interface up front
- No init() side effects beyond registration; wiring happens in main/composition root
- Table-driven tests for branching logic; `t.Helper()` in test helpers

## Dependencies & Config
- `go.mod`/`go.sum` committed; no replace directives left without a comment why
- No global mutable state — config passed explicitly or via struct fields

## Security
- SQL through placeholders — no `fmt.Sprintf` or `+` building a query from input
- `exec.Command` takes arguments, never `sh -c` with input
- Paths built from input are cleaned and checked against an allowed root
- No `InsecureSkipVerify: true` outside tests; secrets and tokens from `crypto/rand`, never `math/rand`

## Performance
- No string concatenation in hot loops — `strings.Builder`
- Slice/map capacity preallocated when size is known
- No N+1 DB calls — batch or join at the repository layer
