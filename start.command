#!/bin/bash
# macOS / Linux double-click launcher.
# Right-click > Open the first time if macOS blocks it (unidentified developer).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed."
  echo "  Install the LTS version from https://nodejs.org then try again."
  echo
  read -r -p "Press Enter to close..."
  exit 1
fi

# Open the browser shortly after the server starts.
( sleep 1; (command -v open >/dev/null 2>&1 && open http://localhost:3000) \
  || (command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:3000) ) &

echo "  Starting order tracker... (close this window or press Ctrl+C to stop)"
node server/index.js
