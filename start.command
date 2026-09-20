#!/bin/bash
# Double-click this file to run Mindmapper.
#
# The first time, macOS may refuse because the file came from the internet:
# right-click it, choose Open, then Open again. After that a double-click works.
#
# Close the Terminal window (or press Ctrl+C) to stop the app.

cd "$(dirname "$0")" || exit 1
PORT="${PORT:-4173}"
URL="http://localhost:$PORT/"

if ! command -v node > /dev/null 2>&1; then
  echo "Mindmapper needs Node.js, which does not seem to be installed."
  echo "Install it from https://nodejs.org (the LTS build is fine), then"
  echo "double-click this file again."
  echo
  read -r -p "Press return to close."
  exit 1
fi

# Open the browser once the server is actually answering.
(
  for _ in $(seq 1 50); do
    if curl -s -o /dev/null "$URL"; then
      command -v open > /dev/null 2>&1 && open "$URL"
      exit 0
    fi
    sleep 0.2
  done
) &

echo "Mindmapper is running at $URL"
echo "Leave this window open while you use it. Press Ctrl+C to stop."
echo
exec node scripts/serve.mjs "$PORT"
