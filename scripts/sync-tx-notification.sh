#!/usr/bin/env bash
# Syncs TxNotificationCenter.tsx from embedded-wallet to in-workspace apps.
# Run this after editing packages/embedded-wallet/src/TxNotificationCenter.tsx.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
SRC="$ROOT/packages/embedded-wallet/src/TxNotificationCenter.tsx"

sync_copy() {
  local dest="$1"
  local import="$2"
  sed "s|from \"./tx-progress.js\"|from \"$import\"|" "$SRC" > "$dest"
  echo "  → $dest"
}

echo "Syncing TxNotificationCenter..."
sync_copy "$ROOT/packages/bridge/src/components/TxNotificationCenter.tsx" "@gregojuice/embedded-wallet"
sync_copy "$ROOT/packages/fpc-operator/src/components/TxNotificationCenter.tsx" "@gregojuice/embedded-wallet"
echo "Done."
