#!/usr/bin/env bash
# Runs inside a freshly created item worktree: kf verify runs there, so it needs the project's dependencies.
set -euo pipefail
npm ci --silent
