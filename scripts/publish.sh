#!/usr/bin/env bash
set -euo pipefail

if [ -z "${NPM_TOKEN:-}" ]; then
  echo "Error: NPM_TOKEN environment variable is not set."
  echo "Usage: NPM_TOKEN=npm_xxxx yarn publish:packages"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Build both packages
echo "Building @gregojuice/embedded-wallet..."
cd "$ROOT_DIR/packages/embedded-wallet"
yarn build

echo "Building @gregojuice/contracts..."
cd "$ROOT_DIR/packages/contracts"
yarn build

# Publish with the token
echo "Publishing @gregojuice/embedded-wallet..."
cd "$ROOT_DIR/packages/embedded-wallet"
npm publish --access public --registry https://registry.npmjs.org/ --//registry.npmjs.org/:_authToken="$NPM_TOKEN"

echo "Publishing @gregojuice/contracts..."
cd "$ROOT_DIR/packages/contracts"
npm publish --access public --registry https://registry.npmjs.org/ --//registry.npmjs.org/:_authToken="$NPM_TOKEN"

echo "Done! Both packages published."
