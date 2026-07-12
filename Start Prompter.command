#!/bin/bash
# Double-click this on Mac (Finder).
# Installs dependencies if needed, starts Prompter, opens your browser.

cd "$(dirname "$0")" || exit 1

clear
echo ""
echo "  Prompter"
echo "  --------"
echo "  One-click start (installs deps if needed)."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed yet (one-time)."
  echo "  1. Open https://nodejs.org"
  echo "  2. Download LTS and install"
  echo "  3. Double-click this file again"
  echo ""
  echo "  Press Enter to close…"
  read -r
  exit 1
fi

# Run launcher (npm install + server + browser)
node start.js
status=$?

echo ""
if [ "$status" -ne 0 ]; then
  echo "  Something went wrong (code $status)."
  echo "  Press Enter to close…"
  read -r
  exit "$status"
fi

# If start.js exits immediately (already running), pause briefly
echo "  Press Enter to close this window…"
read -r
