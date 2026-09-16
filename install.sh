#!/usr/bin/env bash
set -euo pipefail

KABAN_FLOW_VERSION="1.0.0"
KABAN_FLOW_HOME="${KABAN_FLOW_HOME:-$HOME/.claude}"

usage() {
  cat <<EOF
kaban-flow $KABAN_FLOW_VERSION — Kanban workflow for AI-assisted feature development

Usage:
  curl -fsSL https://raw.githubusercontent.com/phuthuycoding/kaban-flow/main/install.sh | bash          # install globally
  ./install.sh                  # install globally (same as above)
  ./install.sh init             # init project: create .works/ + docs/use-cases/
  ./install.sh uninstall        # remove skills + kanban-flow config

Environment variables:
  KABAN_FLOW_HOME    Override base dir (default: ~/.claude)

EOF
  exit 0
}

install_global() {
  local SCRIPT_DIR
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  echo "Installing kaban-flow $KABAN_FLOW_VERSION..."

  # Skills
  mkdir -p "$KABAN_FLOW_HOME/skills"
  for skill_dir in "$SCRIPT_DIR"/skills/kanban-*/; do
    local skill_name
    skill_name="$(basename "$skill_dir")"
    cp -r "$skill_dir" "$KABAN_FLOW_HOME/skills/$skill_name"
    echo "  ✓ skills/$skill_name"
  done

  # Kanban flow config (templates + review rules)
  mkdir -p "$KABAN_FLOW_HOME/kanban-flow"
  cp -r "$SCRIPT_DIR/kanban-flow/templates" "$KABAN_FLOW_HOME/kanban-flow/"
  cp -r "$SCRIPT_DIR/kanban-flow/review"    "$KABAN_FLOW_HOME/kanban-flow/"
  echo "  ✓ kanban-flow/templates/"
  echo "  ✓ kanban-flow/review/rules/"

  echo ""
  echo "Installed to $KABAN_FLOW_HOME/"
  echo ""
  echo "Skills available (restart your AI assistant to detect them):"
  echo "  /kanban-brainstorm {context} {feature}"
  echo "  /kanban-plan      {context} {feature}"
  echo "  /kanban-implement  {context} {feature}"
  echo "  /kanban-test       {context} {feature}"
  echo "  /kanban-review     {context} {feature}"
  echo "  /kanban-archive    {context} {feature}"
  echo ""
  echo "Next: cd your-project && ./install.sh init"
}

init_project() {
  local CWD
  CWD="$(pwd)"

  echo "Initializing kaban-flow in $CWD..."

  # .works structure
  mkdir -p "$CWD"/.works/{backlog,pending,doing,testing,review,dones}
  echo "  ✓ .works/{backlog,pending,doing,testing,review,dones}"

  # docs structure
  mkdir -p "$CWD/docs/use-cases"
  echo "  ✓ docs/use-cases/"

  # Project-level review rules dir (empty, ready to add project-specific rules)
  mkdir -p "$CWD/.claude/review/rules"
  echo "  ✓ .claude/review/rules/ (add project-specific rules here)"

  # .gitignore entries if .git exists
  if [ -d "$CWD/.git" ]; then
    local GI="$CWD/.gitignore"
    if [ ! -f "$GI" ] || ! grep -q "\.works/" "$GI" 2>/dev/null; then
      cat >> "$GI" <<'EOF'

# kaban-flow
.works/doing/
.works/testing/
.works/review/
EOF
      echo "  ✓ Updated .gitignore"
    fi
  fi

  echo ""
  echo "Project initialized!"
  echo "Start with: /kanban-brainstorm {context} {feature_name}"
}

uninstall() {
  echo "Uninstalling kaban-flow..."

  # Remove skills
  for skill_dir in "$KABAN_FLOW_HOME"/skills/kanban-*/; do
    [ -d "$skill_dir" ] || continue
    local skill_name
    skill_name="$(basename "$skill_dir")"
    rm -rf "$skill_dir"
    echo "  ✗ skills/$skill_name"
  done

  # Remove kanban-flow config
  if [ -d "$KABAN_FLOW_HOME/kanban-flow" ]; then
    rm -rf "$KABAN_FLOW_HOME/kanban-flow"
    echo "  ✗ kanban-flow/"
  fi

  echo ""
  echo "Uninstalled. Project .works/ folders were not touched."
}

# --- main ---
case "${1:-install}" in
  install)   install_global ;;
  init)      init_project ;;
  uninstall) uninstall ;;
  -h|--help) usage ;;
  *)         echo "Unknown command: $1"; usage ;;
esac
