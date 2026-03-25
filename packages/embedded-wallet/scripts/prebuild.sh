#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$SCRIPT_DIR/.."
CONTRACTS_DIR="$PKG_DIR/../contracts"

mkdir -p "$PKG_DIR/src/artifacts"

# Copy codegen'd wrapper + compiled JSON artifact
cp "$CONTRACTS_DIR/artifacts/SchnorrInitializerlessAccount.ts" "$PKG_DIR/src/artifacts/"
cp "$CONTRACTS_DIR/target/schnorr_initializerless_account_contract-SchnorrInitializerlessAccount.json" "$PKG_DIR/src/artifacts/"

# Patch the JSON import path (codegen points to ../target/, we have it alongside)
sed -i'' -e 's|../target/schnorr_initializerless_account_contract-SchnorrInitializerlessAccount.json|./schnorr_initializerless_account_contract-SchnorrInitializerlessAccount.json|' "$PKG_DIR/src/artifacts/SchnorrInitializerlessAccount.ts"
