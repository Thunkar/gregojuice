/**
 * JSON backup format shared between `deploy-fpc.ts` / `register-fpc-signups.ts`
 * and the fpc-operator UI's Backup/Restore tab. Both sides read and write the
 * same on-disk shape at `apps/fpc-operator/backups/<network>.fpc-admin.json`,
 * so re-importing a script-produced backup in the UI hydrates everything
 * (admin account, FPC contract, signed-up apps).
 *
 * Matches `BackupData` in apps/fpc-operator/src/services/backupService.ts —
 * keep both in sync when the shape changes (bump `BACKUP_VERSION`).
 */
import fs from "fs";
import path from "path";

export const BACKUP_VERSION = 1;

/** Mirror of `StoredFPC` from the fpc-operator app. */
export interface StoredFPC {
  address: string;
  secretKey: string;
  salt: string;
  deployed: boolean;
}

/** Mirror of `SignedUpApp` from the fpc-operator app. */
export interface SignedUpApp {
  appAddress: string;
  functionSelector: string;
  configIndex: number;
  maxUses: number;
  maxFee: string;
  maxUsers: number;
  createdAt: number;
}

export interface FpcAdminBackup {
  version: number;
  exportedAt: string;
  network: string | null;
  admin: {
    secretKey: string;
    salt: string;
    address: string;
  };
  fpc: StoredFPC | null;
  apps: SignedUpApp[];
  calibrationIndices: Record<string, number>;
}

/**
 * Resolves the canonical backup file path for a network without requiring
 * the caller to know the exact folder layout. Uses the repo root (found by
 * walking up from `cwd` until a `package.json` with a workspaces field is
 * found) as the anchor.
 */
export function resolveFpcAdminBackupPath(
  network: string,
  startDir: string = process.cwd(),
): string {
  let dir = path.resolve(startDir);
  while (dir !== path.dirname(dir)) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const content = JSON.parse(fs.readFileSync(pkg, "utf-8"));
        if (Array.isArray(content.workspaces) || content.workspaces?.packages) {
          break;
        }
      } catch {
        // fall through
      }
    }
    dir = path.dirname(dir);
  }
  return path.join(dir, "apps", "fpc-operator", "backups", `${network}.fpc-admin.json`);
}

/** Returns the parsed backup file, or `null` if it doesn't exist / is invalid. */
export function readFpcAdminBackup(backupPath: string): FpcAdminBackup | null {
  if (!fs.existsSync(backupPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(backupPath, "utf-8")) as FpcAdminBackup;
  } catch {
    return null;
  }
}

export interface WriteFpcAdminBackupParams {
  backupPath: string;
  network: string;
  admin: FpcAdminBackup["admin"];
  fpc?: StoredFPC | null;
  apps?: SignedUpApp[];
  calibrationIndices?: Record<string, number>;
}

/**
 * Writes the backup file, merging with anything already on disk so partial
 * updates (e.g. `deploy-fpc` writing admin+fpc, then `register-fpc-signups`
 * layering on `apps`) don't clobber each other.
 *
 * Fields passed in `params` take precedence over existing on-disk values.
 */
export function writeFpcAdminBackup(params: WriteFpcAdminBackupParams): void {
  const existing = readFpcAdminBackup(params.backupPath);

  const merged: FpcAdminBackup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    network: params.network,
    admin: params.admin,
    fpc: params.fpc !== undefined ? params.fpc : (existing?.fpc ?? null),
    apps: params.apps !== undefined ? params.apps : (existing?.apps ?? []),
    calibrationIndices:
      params.calibrationIndices !== undefined
        ? params.calibrationIndices
        : (existing?.calibrationIndices ?? {}),
  };

  fs.mkdirSync(path.dirname(params.backupPath), { recursive: true });
  fs.writeFileSync(params.backupPath, JSON.stringify(merged, null, 2));
}
