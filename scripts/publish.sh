#!/usr/bin/env bash
set -euo pipefail

if [ -z "${NPM_TOKEN:-}" ]; then
  echo "Error: NPM_TOKEN environment variable is not set."
  echo "Usage: NPM_TOKEN=npm_xxxx yarn publish:packages [--minor | --major]"
  exit 1
fi

# Parse bump type
BUMP="patch"
for arg in "$@"; do
  case "$arg" in
    --minor) BUMP="minor" ;;
    --major) BUMP="major" ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

PACKAGES=(
  "$ROOT_DIR/packages/embedded-wallet"
  "$ROOT_DIR/packages/aztec"
  "$ROOT_DIR/packages/ethereum"
)

# Bump versions based on latest published version from npm
for pkg in "${PACKAGES[@]}"; do
  cd "$pkg"
  PKG_NAME=$(node -p "require('./package.json').name")
  PUBLISHED=$(npm view "$PKG_NAME" version 2>/dev/null || echo "0.0.0")
  NEW_VERSION=$(node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const [major, minor, patch] = '$PUBLISHED'.split('.').map(Number);
    if ('$BUMP' === 'major') pkg.version = (major+1)+'.0.0';
    else if ('$BUMP' === 'minor') pkg.version = major+'.'+(minor+1)+'.0';
    else pkg.version = major+'.'+minor+'.'+(patch+1);
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    process.stdout.write(pkg.version);
  ")
  echo "$PKG_NAME: $PUBLISHED → $NEW_VERSION"
done

# Build
echo ""
echo "Building @gregojuice/aztec..."
cd "$ROOT_DIR/packages/aztec"
yarn build

echo "Building @gregojuice/ethereum..."
cd "$ROOT_DIR/packages/ethereum"
yarn build

echo "Building @gregojuice/embedded-wallet..."
cd "$ROOT_DIR/packages/embedded-wallet"
yarn build

# Publish (yarn npm publish rewrites workspace:* refs to real versions)
export YARN_NPM_AUTH_TOKEN="$NPM_TOKEN"

echo ""
echo "Publishing @gregojuice/aztec..."
cd "$ROOT_DIR/packages/aztec"
yarn npm publish --access public

echo "Publishing @gregojuice/ethereum..."
cd "$ROOT_DIR/packages/ethereum"
yarn npm publish --access public

echo "Publishing @gregojuice/embedded-wallet..."
cd "$ROOT_DIR/packages/embedded-wallet"
yarn npm publish --access public

echo ""
echo "Done! All packages published ($BUMP bump)."
