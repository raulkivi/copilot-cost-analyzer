#!/usr/bin/env bash
# Adds a shell alias that starts this app (npm start) and opens it in a
# browser. Safe to re-run — replaces its own previous entry instead of
# duplicating it. Also offers to build and install the optional
# pi-system-prompt-logger extension into your pi coding-agent install.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ALIAS_NAME="${CPCHAT_ALIAS:-cpchat}"
MARKER="# copilot-cost-analyzer alias (managed by scripts/install.sh)"
ALIAS_LINE="alias ${ALIAS_NAME}='cd \"${REPO_DIR}\" && npm start'"

detect_profile() {
  case "${SHELL:-}" in
    */zsh) echo "$HOME/.zshrc" ;;
    */bash) [ -f "$HOME/.bashrc" ] && echo "$HOME/.bashrc" || echo "$HOME/.bash_profile" ;;
    *) echo "$HOME/.profile" ;;
  esac
}

PROFILE="${CPCHAT_PROFILE:-$(detect_profile)}"
touch "$PROFILE"

if grep -qF "$MARKER" "$PROFILE"; then
  tmp="$(mktemp)"
  awk -v marker="$MARKER" '
    $0 == marker { skip=1; next }
    skip == 1 { skip=0; next }
    { print }
  ' "$PROFILE" > "$tmp"
  # drop the trailing blank line this script previously appended
  sed -i -e '${/^$/d}' "$tmp"
  mv "$tmp" "$PROFILE"
fi

printf '\n%s\n%s\n' "$MARKER" "$ALIAS_LINE" >> "$PROFILE"

echo "Added '${ALIAS_NAME}' alias to ${PROFILE}"
echo
echo "Run this to use it now:"
echo "  source ${PROFILE}"
echo
echo "Then '${ALIAS_NAME}' starts the app and opens it in your browser."

# Optional: install packages/pi-system-prompt-logger (an extension that
# captures pi's assembled system prompt, so Analyze mode's pi-agent sessions
# can show it in the system prompt inspector). Independent of the alias
# setup above — a build failure here warns and continues rather than
# aborting the rest of this script.
PI_EXTENSIONS_DIR="${CPCHAT_PI_EXTENSIONS_DIR:-$HOME/.pi/agent/extensions}"
INSTALL_PI_EXTENSION="${CPCHAT_INSTALL_PI_EXTENSION:-}"

if [ -z "$INSTALL_PI_EXTENSION" ]; then
  if [ -t 0 ]; then
    echo
    read -r -p "Install pi coding-agent system-prompt capture support? [y/N] " reply
    case "$reply" in
      [Yy]*) INSTALL_PI_EXTENSION="yes" ;;
      *) INSTALL_PI_EXTENSION="no" ;;
    esac
  else
    INSTALL_PI_EXTENSION="no"
  fi
fi

if [ "$INSTALL_PI_EXTENSION" = "yes" ]; then
  echo
  echo "Building pi-system-prompt-logger..."
  if (cd "$REPO_DIR" && npm run bundle --workspace=packages/pi-system-prompt-logger); then
    mkdir -p "$PI_EXTENSIONS_DIR"
    cp "$REPO_DIR/packages/pi-system-prompt-logger/dist/pi-system-prompt-logger.js" "$PI_EXTENSIONS_DIR/"
    echo "Installed pi coding-agent system-prompt capture to ${PI_EXTENSIONS_DIR}/pi-system-prompt-logger.js"
    echo "Restart pi (or run /reload inside a session) for it to take effect."
  else
    echo "Warning: failed to build pi-system-prompt-logger — skipping its install." >&2
    echo "Retry later with: npm run bundle --workspace=packages/pi-system-prompt-logger" >&2
  fi
fi
