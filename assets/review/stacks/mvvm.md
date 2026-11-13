# MVVM Review Rules

## Layer Boundaries
- A View renders state and forwards user intent — no business rule, network call, persistence or navigation decision in it
- A ViewModel holds presentation state and logic — it imports no UI framework view type and holds no reference to a View, a context or a controller
- A Model (domain and data) knows nothing of ViewModels or Views; dependencies point inward only
- Data sources are reached through a repository or service interface, never called from a ViewModel by their concrete client

## State
- The ViewModel exposes one observable state per screen (or a small set), read-only to the View; the View never mutates it directly
- State is a value the View can render at any moment: loading, content, empty and error are explicit, not inferred from nulls
- One-off events (navigation, toast, dialog) go through an event channel consumed once — not a flag left in state
- No duplicated source of truth: a value derived from state is computed, not stored beside it

## Lifecycle & Concurrency
- Work started by a ViewModel is tied to its scope and cancelled when it is cleared; no task outlives the screen by accident
- Observers, bindings and subscriptions are released with the View's lifecycle — no retain cycle between View and ViewModel
- UI state is updated on the main thread; blocking work never runs there
- A repeated user action (double tap, re-entry) cannot start the same operation twice

## Dependencies
- A ViewModel receives its dependencies through its constructor — no service locator or singleton looked up inside
- ViewModels do not call each other; shared behaviour lives in a use case or a service both depend on
- Mapping between API, storage and UI models happens at the layer boundary, not inside the View

## Testing
- ViewModel logic is covered by unit tests that run without the UI framework, with fakes for repositories
- Each state transition a screen can show (loading → content, → empty, → error) has a test
- Views are covered by UI tests for wiring only; a rule tested only through the UI belongs in the ViewModel
