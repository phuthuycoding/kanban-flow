# General Code Review Rules

## Error Handling
- Never swallow errors (empty catch/try)
- Catch only specific exception types
- Every catch must handle or rethrow with context
- App must not panic on exception
- Log with stack trace, request id, input, and correct level

## Code Quality
- One file max 500 lines (if longer, re-evaluate responsibilities)
- Split by responsibility, not by line count
- One file = one clear responsibility
- Separate UI logic from display logic when file grows

## Naming & Changes
- Do not rename functions/files for style preference only
- Rename only when name causes semantic confusion
- No reformatting existing code (no import reorder, no quote changes)
- Each edit = one purpose, no refactoring during bug fix

## Comments
- No unnecessary comments describing what code does
- Comment only "why" (decisions, constraints, gotchas)
- No TODO comments, no "changed by AI", no "removed old logic"

## Security
- Never commit secrets or keys
- Never expose secrets in logs
- Validate and sanitize input at boundaries
