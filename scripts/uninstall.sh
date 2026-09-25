#!/usr/bin/env bash
# Removes the alias added by scripts/install.sh from your shell profile, and
# the pi-system-prompt-logger extension if install.sh installed it. Safe to
# re-run — a no-op if neither is present.
set -euo pipefail

MARKER="# copilot-cost-analyzer alias (managed by scripts/install.sh)"

detect_profile() {
  case "${SHELL:-}" in
    */zsh) echo "$HOME/.zshrc" ;;
    */bash) [ -f "$HOME/.bashrc" ] && echo "$HOME/.bashrc" || echo "$HOME/.bash_profile" ;;
    *) echo "$HOME/.profile" ;;
  esac
}

PROFILE="${CPCHAT_PROFILE:-$(detect_profile)}"

if [ -f "$PROFILE" ] && grep -qF "$MARKER" "$PROFILE"; then
  tmp="$(mktemp)"
  awk -v marker="$MARKER" '
    $0 == marker { skip=1; next }
    skip == 1 { skip=0; next }
    { print }
  ' "$PROFILE" > "$tmp"
  # drop the blank line install.sh put before the marker
  sed -i -e '${/^$/d}' "$tmp"
  mv "$tmp" "$PROFILE"

  echo "Removed the alias from ${PROFILE}"
  echo "Run 'source ${PROFILE}' (or open a new terminal) for this to take effect."
else
  echo "No copilot-cost-analyzer alias found in ${PROFILE} — nothing to do."
fi

PI_EXTENSIONS_DIR="${CPCHAT_PI_EXTENSIONS_DIR:-$HOME/.pi/agent/extensions}"
PI_EXTENSION_FILE="$PI_EXTENSIONS_DIR/pi-system-prompt-logger.js"
if [ -f "$PI_EXTENSION_FILE" ]; then
  rm -f "$PI_EXTENSION_FILE"
  echo "Removed the pi coding-agent system-prompt capture extension (${PI_EXTENSION_FILE})"
fi
