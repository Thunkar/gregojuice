import fs from "fs";
import path from "path";
import type { Plugin, ResolvedConfig } from "vite";

export interface ChunkSizeLimit {
  /** Pattern to match chunk file names (e.g., /assets\/index-.*\.js$/) */
  pattern: RegExp;
  /** Maximum size in kilobytes */
  maxSizeKB: number;
  /** Optional description for logging */
  description?: string;
}

/**
 * Checks chunk sizes after build completes and fails if any limit is exceeded.
 * No-op during dev (`serve`) and in watch mode.
 */
export function chunkSizeValidator(limits: ChunkSizeLimit[]): Plugin {
  let config: ResolvedConfig;

  return {
    name: "chunk-size-validator",
    enforce: "post",
    apply: "build",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    closeBundle() {
      const outDir = this.meta?.watchMode ? null : "dist";
      if (!outDir) return;

      const logger = config.logger;
      const violations: string[] = [];
      const checkDir = (dir: string, baseDir: string = "") => {
        const files = fs.readdirSync(dir);

        for (const file of files) {
          const filePath = path.join(dir, file);
          const relativePath = path.join(baseDir, file);
          const stat = fs.statSync(filePath);

          if (stat.isDirectory()) {
            checkDir(filePath, relativePath);
            continue;
          }

          if (!stat.isFile()) continue;
          const sizeKB = stat.size / 1024;

          for (const limit of limits) {
            if (!limit.pattern.test(relativePath)) continue;
            const desc = limit.description ? ` (${limit.description})` : "";
            logger.info(
              `  ${relativePath}: ${sizeKB.toFixed(2)} KB / ${limit.maxSizeKB} KB${desc}`,
            );
            if (sizeKB > limit.maxSizeKB) {
              violations.push(
                `  ❌ ${relativePath}: ${sizeKB.toFixed(2)} KB exceeds limit of ${limit.maxSizeKB} KB${desc}`,
              );
            }
          }
        }
      };

      logger.info("\n📦 Validating chunk sizes...");
      checkDir(path.resolve(process.cwd(), outDir));

      if (violations.length > 0) {
        logger.error("\n❌ Chunk size validation failed:\n");
        violations.forEach((v) => logger.error(v));
        logger.error("\n");
        throw new Error("Build failed: chunk size limits exceeded");
      }
      logger.info("✅ All chunks within size limits\n");
    },
  };
}
