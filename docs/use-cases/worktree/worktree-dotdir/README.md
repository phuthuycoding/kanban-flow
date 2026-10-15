# Use Case Specification — worktree-dotdir

## UC-001: default create lands inside the repo
Actor: developer. Flow: `kf worktree create x` → path `<repo>/.worktrees/x`, `.gitignore` covers it, `git status` clean, ADE attach identical. Alt: `.gitignore` unwritable → warn, create proceeds.

## UC-002: explicit baseDir still wins
`.kf/config.json` sets `worktree.baseDir` → path resolved as before; no `.worktrees/` line is written when the dir is outside the repo.

## UC-003: repo initialized before the change
First create appends `.worktrees/` lazily; subsequent creates skip the write.
