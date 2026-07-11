#!/bin/bash
# Double-click this on Mac (Finder).
cd "$(dirname "$0")" || exit 1

clear
echo ""
echo "  Prompter"
echo "  --------"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed."
  echo "  Get it here (LTS): https://nodejs.org"
  echo ""
  echo "  Press Enter to close…"
  read -r
  exit 1
fi

# Prefer the launcher (opens browser + starts server)
exec node start.js
