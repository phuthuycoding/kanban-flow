# Use Case Diagram — worktree-dotdir
User → kf worktree create → <repo>/.worktrees/<feature> (gitignored) → ADE attach unchanged.
User → .kf/config.json worktree.baseDir → custom dir wins over default.
