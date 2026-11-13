# Frontend Review Rules

## Rendering & State
- State lives at the lowest component that needs it; server data is not copied into local state without a reason
- Derived values are computed during render, not stored and synced through an effect
- Effects declare every value they read as a dependency and return a cleanup for each subscription, timer and listener
- List items carry a stable key from the data, never the array index of a list that reorders or filters
- No direct mutation of props, store state or query-cache objects

## Data Fetching
- Requests started by a component are cancelled or ignored when it unmounts or its inputs change (no stale response overwriting a newer one)
- Loading, empty and error states are each rendered — a failed request never leaves a blank or spinning screen
- No request per keystroke without debounce; no fetch inside a render path or an unguarded loop
- API responses are validated or typed at the boundary before components read them

## Security
- No raw HTML injection (`dangerouslySetInnerHTML`, `v-html`, `innerHTML`) with content that carries user input, unless sanitized where it is set
- URLs from data are checked before use in `href`/`src` (no `javascript:` scheme); external links opened in a new tab carry `rel="noopener"`
- No secret, private key or privileged token in client code or in a variable exposed to the bundle
- Auth tokens are not written to `localStorage` when the project uses http-only cookies

## Accessibility & UX
- Interactive elements are real buttons, links and inputs, reachable and operable by keyboard, with a visible focus state
- Inputs have labels; images that carry meaning have alt text; icon-only buttons have an accessible name
- Form errors are shown next to the field and announced; submit is disabled or guarded against double send
- User-visible text follows the project's copy and i18n mechanism — no hard-coded strings where translations exist

## Structure & Testing
- A component does one job; data access and business rules live outside the view (a hook, a store, a service)
- No new dependency for something the framework or an existing project dependency already does
- Tests query by role, label or `data-testid` the plan fixes — never by CSS class or DOM position
- Styles follow the project's system (tokens, utility classes, modules) — no one-off inline values for colours and spacing the system defines
