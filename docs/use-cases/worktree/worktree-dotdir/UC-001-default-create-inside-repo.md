# UC-001: default create lands inside the repo
Actor: developer. `kf worktree create x` → path `<repo>/.worktrees/x`; `.gitignore` covers `.worktrees/`; `git status` clean; ADE attach identical. Alt: `.gitignore` unwritable → warn, create proceeds.
