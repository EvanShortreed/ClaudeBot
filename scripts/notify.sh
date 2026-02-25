#!/bin/bash
# macOS notification helper for ClaudeClaw
# Usage: notify.sh "Title" "Message"

TITLE="${1:-ClaudeClaw}"
MESSAGE="${2:-Notification}"

if command -v osascript &> /dev/null; then
  osascript -e "display notification \"$MESSAGE\" with title \"$TITLE\""
elif command -v notify-send &> /dev/null; then
  notify-send "$TITLE" "$MESSAGE"
else
  echo "[$TITLE] $MESSAGE"
fi
