# UC-003: repo initialized before the change
First create appends `.worktrees/` to `.gitignore` lazily; subsequent creates skip the write; no duplicates.
