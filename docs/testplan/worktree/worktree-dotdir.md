# Test Cases — worktree-dotdir

## TC-001
- Requirement: FR-001
- Use case: UC-001
- Given a repo without `worktree.baseDir`
- When `kf worktree create x` runs
- Then the worktree path is `<root>/.worktrees/x` and `git status` stays clean.

## TC-002
- Requirement: FR-002
- Use case: UC-003
- Given a repo whose `.gitignore` only has `.works/`
- When a worktree is created twice
- Then `.gitignore` gains `.worktrees/` exactly once.

## TC-003
- Requirement: FR-002
- Use case: UC-001
- Given `.gitignore` containing `.worktrees` or `/.worktrees/`
- When a worktree is created
- Then no additional ignore line is written.

## TC-004
- Requirement: FR-001, FR-002
- Use case: UC-002
- Given `worktree.baseDir` pointing outside the repo
- When a worktree is created
- Then the path is unchanged and no `.worktrees/` line is written.

## TC-005
- Requirement: FR-001
- Use case: UC-001, UC-003
- Given worktrees registered under `<repo>-worktrees/`
- When `worktree list`/remove runs
- Then they keep working; only new creations use `.worktrees/`.
