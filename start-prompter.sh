#!/usr/bin/env bash
# Double-click / run on Mac or Linux.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get LTS from https://nodejs.org"
  exit 1
fi

exec node start.js
