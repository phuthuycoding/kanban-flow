#!/usr/bin/env bash
# Generic GitHub sync — delivered: the delivery event, fired by `kf issues done`.
# Closes the linked issue and moves the board card to statusMap.delivered (default "Done").
# Fail-open on GitHub outages — the command records `delivered` regardless and a re-run
# reconciles; fail-closed only on an unreadable .kfw.json.
. "$(dirname "$0")/lib-github.sh" || exit 0
[ -n "${KFW_REPOSITORY:-}" ] || exit 0
gh_ready || exit 0

url=$(issue_url_of "$KFW_FEATURE_DIR"); rc=$?
if [ $rc -eq 2 ]; then
  echo "[github-sync] ERROR cannot read .kfw.json for $KFW_FEATURE — refusing delivered" >&2
  exit 1
fi
[ -n "$url" ] || exit 0

sync_project_status "$KFW_FEATURE_DIR" delivered
close_issue_done "$KFW_FEATURE_DIR" "Delivered — kf issues done."
exit 0
