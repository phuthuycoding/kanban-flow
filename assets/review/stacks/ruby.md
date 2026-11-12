# Ruby Review Rules

## Error Handling
- No bare `rescue` or `rescue Exception` — rescue specific error classes only
- No `rescue` that returns `nil`/`false` to hide failures — handle, wrap, or re-raise
- `raise` uses typed error classes with context, not generic strings where a type exists
- Cleanup in `ensure`/block forms — no manual close paths that exceptions can bypass

## Rails & Data Access
- Strong params on all mass assignment — no `params.permit!` or unfiltered `Model.new(params)`
- No N+1 — `includes`/`preload` verified for every association rendered in a loop
- Transactions wrap multi-write operations; uniqueness handled by constraints, not check-then-act
- No `update_column`/`update_attribute` skipping validations without a comment justifying it
- Migrations reversible and deploy-safe — no rename-and-drop in a single release

## Code Quality
- `rubocop` (project config) clean on changed files — inline disables carry a comment why
- No monkey-patching core or third-party classes; refinements/wrappers where unavoidable
- `frozen_string_literal` respected — no mutation of string literals
- Predicate methods end in `?`; bang (`!`) reserved for raising/dangerous variants
- `respond_to_missing?` defined alongside any `method_missing`

## Security
- No `constantize`/`send`/`public_send` on user-controlled strings — explicit allowlist dispatch
- SQL fragments (`where`, `order`, `joins` strings) use bind params — no interpolation of input
- `system`/backticks/`Open3` never interpolate user input into commands
- Secrets via credentials/env — no keys in code, fixtures, or committed config

## Performance
- No `Model.all.each` on unbounded tables — `find_each`/`in_batches` for iteration
- `pluck`/`select` used over full model instantiation when only columns are needed
- Memoization (`||=`) only for stable values — never keyed on mutable or per-request state
