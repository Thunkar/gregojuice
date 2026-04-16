#!/usr/bin/env node

/**
 * Update gregojuice to the latest Aztec nightly version.
 *
 * Usage:
 *   node scripts/update.js [--version VERSION] [--skip-aztec-up]
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Color codes
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
};

function log(color, message) {
  console.log(`${color}${message}${COLORS.reset}`);
}

function exec(command, options = {}) {
  return execSync(command, {
    cwd: ROOT,
    stdio: options.silent ? 'pipe' : 'inherit',
    encoding: 'utf-8',
    ...options,
  });
}

async function fetchLatestNightly() {
  log(COLORS.yellow, 'Fetching latest nightly from npm...');
  try {
    const output = exec('npm view @aztec/aztec.js versions --json', { silent: true });
    const versions = JSON.parse(output);
    const nightlies = versions.filter(v => v.match(/^4\.\d+\.\d+-nightly\.\d+$/));
    const latest = nightlies[nightlies.length - 1];
    if (!latest) {
      throw new Error('No nightly versions found');
    }
    return latest;
  } catch (error) {
    log(COLORS.red, 'Failed to fetch latest nightly version from npm');
    log(COLORS.red, 'Please specify a version with --version');
    process.exit(1);
  }
}

function updatePackageJsonFiles(version) {
  log(COLORS.yellow, '[1/5] Updating package.json files...');

  const packagesDir = resolve(ROOT, 'packages');
  const packages = readdirSync(packagesDir).filter(name => {
    const pkgPath = join(packagesDir, name, 'package.json');
    try {
      statSync(pkgPath);
      return true;
    } catch {
      return false;
    }
  });

  for (const pkg of packages) {
    const path = join(packagesDir, pkg, 'package.json');
    let content = readFileSync(path, 'utf-8');
    const original = content;

    // Update @aztec/* dependency versions
    content = content.replace(/"(@aztec\/[^"]+)": "v[^"]+"/g, `"$1": "v${version}"`);

    if (content !== original) {
      writeFileSync(path, content, 'utf-8');
      log(COLORS.green, `  ✓ packages/${pkg}/package.json`);
    }
  }

  log(COLORS.green, '✓ package.json files updated\n');
}

function findNargoTomlFiles(dir) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'target') {
      results.push(...findNargoTomlFiles(fullPath));
    } else if (entry.name === 'Nargo.toml') {
      results.push(fullPath);
    }
  }
  return results;
}

function updateNargoToml(version) {
  log(COLORS.yellow, '[2/5] Updating Nargo.toml files...');

  const contractsDir = resolve(ROOT, 'packages/contracts');
  const nargoFiles = findNargoTomlFiles(contractsDir);

  for (const nargoPath of nargoFiles) {
    let content = readFileSync(nargoPath, 'utf-8');
    const original = content;

    // Update aztec-nr tags
    content = content.replace(
      /(git\s*=\s*"https:\/\/github\.com\/AztecProtocol\/aztec-nr"[^}]*tag\s*=\s*")v[^"]+"/g,
      `$1v${version}"`,
    );

    // Update aztec-packages tags
    content = content.replace(
      /(git\s*=\s*"https:\/\/github\.com\/AztecProtocol\/aztec-packages\/?",?\s*tag\s*=\s*")v[^"]+"/g,
      `$1v${version}"`,
    );

    if (content !== original) {
      const relative = nargoPath.replace(ROOT + '/', '');
      writeFileSync(nargoPath, content, 'utf-8');
      log(COLORS.green, `  ✓ ${relative}`);
    }
  }

  log(COLORS.green, '✓ Nargo.toml files updated\n');
}

function installDependencies() {
  log(COLORS.yellow, '[3/5] Running yarn install...');
  exec('yarn install');
  log(COLORS.green, '✓ Dependencies installed\n');
}

function installAztecCLI(version) {
  log(COLORS.yellow, `[4/5] Installing Aztec CLI version ${version}...`);

  // Check if already at the right version
  try {
    const current = exec('aztec --version', { silent: true }).trim();
    if (current === version) {
      log(COLORS.green, `✓ Aztec CLI already at v${version}, skipping\n`);
      return;
    }
  } catch {
    // aztec not installed, proceed with installation
  }

  const isCI = !!process.env.CI;

  if (isCI) {
    log(COLORS.yellow, `Running version-specific installer for ${version}...`);
    process.env.FOUNDRY_DIR = `${process.env.HOME}/.foundry`;
    exec(`curl -fsSL "https://install.aztec.network/${version}/install" | VERSION="${version}" bash`);

    process.env.PATH = `${process.env.HOME}/.aztec/versions/${version}/bin:${process.env.PATH}`;
    process.env.PATH = `${process.env.HOME}/.aztec/versions/${version}/node_modules/.bin:${process.env.PATH}`;
    log(COLORS.green, '✓ Aztec CLI installed (CI mode)\n');
  } else {
    try {
      exec('command -v aztec-up', { silent: true });
      exec(`aztec-up install ${version}`);
      log(COLORS.green, '✓ Aztec CLI updated\n');
    } catch {
      log(
        COLORS.red,
        `Warning: aztec-up not found in PATH. Please install manually with: aztec-up install ${version}\n`,
      );
    }
  }
}

function compileContracts() {
  log(COLORS.yellow, '[5/5] Compiling contracts...');
  exec('yarn compile:contracts');
  log(COLORS.green, '✓ Contracts compiled\n');
}

async function main() {
  log(COLORS.green, '=== Gregojuice Nightly Update Script ===\n');

  // Parse arguments
  const args = process.argv.slice(2);
  let version = null;
  let skipAztecUp = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--version' && args[i + 1]) {
      version = args[i + 1].replace(/^v/, '');
      i++;
    } else if (args[i] === '--skip-aztec-up') {
      skipAztecUp = true;
    } else if (args[i] === '--help') {
      console.log('Usage: node scripts/update.js [OPTIONS]');
      console.log('\nOptions:');
      console.log('  --version VERSION    Specify nightly version (e.g., 4.2.0-nightly.20260412)');
      console.log('  --skip-aztec-up      Skip Aztec CLI installation');
      console.log('  --help               Show this help message');
      process.exit(0);
    }
  }

  // Fetch latest if not specified
  if (!version) {
    version = await fetchLatestNightly();
    log(COLORS.green, `Latest nightly version: v${version}\n`);
  } else {
    log(COLORS.green, `Updating to version: v${version}\n`);
  }

  // Run update steps
  updatePackageJsonFiles(version);
  updateNargoToml(version);
  installDependencies();

  if (!skipAztecUp) {
    installAztecCLI(version);
  } else {
    log(COLORS.yellow, '[4/5] Skipping Aztec CLI installation (--skip-aztec-up flag set)\n');
  }

  compileContracts();

  log(COLORS.green, '=== Update Complete ===');
  log(COLORS.green, `Version: v${version}`);
}

main().catch(error => {
  log(COLORS.red, `Error: ${error.message}`);
  process.exit(1);
});
