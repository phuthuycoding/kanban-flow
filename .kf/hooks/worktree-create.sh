#!/usr/bin/env bash
# Runs inside a freshly created item worktree: kf drive verifies there, so it needs the project's dependencies.
set -euo pipefail
npm ci --silent
