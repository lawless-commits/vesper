#!/bin/sh
# Rebuild static/app.css from styles/app.css with the Tailwind v4 CLI.
# Only needed after changing class names in src/**/*.rs or static/app.js;
# the compiled file is committed, so running Vesper never needs Node.
# Uses a standalone `tailwindcss` binary if one is on PATH, otherwise npx.
set -e
cd "$(dirname "$0")/.."
if command -v tailwindcss >/dev/null 2>&1; then
  tailwindcss -i styles/app.css -o static/app.css --minify
else
  npx --yes @tailwindcss/cli@4.1.17 -i styles/app.css -o static/app.css --minify
fi
