import { defineConfig, loadEnv, Plugin, ResolvedConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react-swc";
import { PolyfillOptions, nodePolyfills } from "vite-plugin-node-polyfills";
import fs from "fs";
import path from "path";
import { resolve } from "path";

// Unfortunate, but needed due to https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/81
// Suspected to be because of the yarn workspace setup, but not sure
const nodePolyfillsFix = (options?: PolyfillOptions | undefined): Plugin => {
  return {
    ...nodePolyfills(options),
    /* @ts-ignore */
    resolveId(source: string) {
      const m = /^vite-plugin-node-polyfills\/shims\/(buffer|global|process)$/.exec(source);
      if (m) {
        return `./node_modules/vite-plugin-node-polyfills/shims/${m[1]}/dist/index.cjs`;
      }
    },
  };
};

/**
 * Lightweight chunk size validator plugin
 * Checks chunk sizes after build completes and fails if limits are exceeded
 */
interface ChunkSizeLimit {
  /** Pattern to match chunk file names (e.g., /assets\/index-.*\.js$/) */
  pattern: RegExp;
  /** Maximum size in kilobytes */
  maxSizeKB: number;
  /** Optional description for logging */
  description?: string;
}

const chunkSizeValidator = (limits: ChunkSizeLimit[]): Plugin => {
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
      if (!outDir) return; // Skip in watch mode

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
          } else if (stat.isFile()) {
            const sizeKB = stat.size / 1024;

            for (const limit of limits) {
              if (limit.pattern.test(relativePath)) {
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
      } else {
        logger.info("✅ All chunks within size limits\n");
      }
    },
  };
};

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Profiling (zone.js-based async context tracking) runs only in dev.
  // V8's "fast await" optimization bypasses user-space Promise.prototype.then
  // for native `async function` bodies, breaking zone.js propagation. By
  // lowering the esbuild/SWC target to es2016 in dev, we force async/await
  // to be transpiled to Promise-based state machines that DO go through
  // user-level .then() — which zone.js can hook. Prod keeps esnext for speed.
  const isDev = command === "serve";
  const esTarget = isDev ? "es2016" : "esnext";

  return {
    base: "./",
    logLevel: process.env.CI ? "error" : undefined,
    esbuild: { target: esTarget },
    build: { target: esTarget },
    server: {
      // Headers needed for bb WASM to work in multithreaded mode
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
      fs: {
        allow: [searchForWorkspaceRoot(process.cwd())],
      },
    },
    resolve: {
      alias: {
        "@gregojuice/embedded-wallet/ui": resolve(
          import.meta.dirname,
          "../../packages/embedded-wallet/src/ui.ts",
        ),
        "@gregojuice/embedded-wallet": resolve(
          import.meta.dirname,
          "../../packages/embedded-wallet/src/index.ts",
        ),
        "@gregojuice/common/ui": resolve(import.meta.dirname, "../../packages/common/src/ui.ts"),
        "@gregojuice/common": resolve(import.meta.dirname, "../../packages/common/src/index.ts"),
        "@gregojuice/aztec/subscription-fpc": resolve(
          import.meta.dirname,
          "../../packages/contracts/aztec/lib/subscription-fpc.ts",
        ),
        "@gregojuice/aztec/fpc-gas-constants": resolve(
          import.meta.dirname,
          "../../packages/contracts/aztec/lib/fpc-gas-constants.ts",
        ),
        "@gregojuice/aztec/artifacts/SubscriptionFPC": resolve(
          import.meta.dirname,
          "../../packages/contracts/aztec/noir/artifacts/SubscriptionFPC.ts",
        ),
        "@gregojuice/aztec/artifacts/Token": resolve(
          import.meta.dirname,
          "../../packages/contracts/aztec/noir/artifacts/Token.ts",
        ),
        "@gregojuice/aztec/artifacts/AMM": resolve(
          import.meta.dirname,
          "../../packages/contracts/aztec/noir/artifacts/AMM.ts",
        ),
        "@gregojuice/aztec/artifacts/ProofOfPassword": resolve(
          import.meta.dirname,
          "../../packages/contracts/aztec/noir/artifacts/ProofOfPassword.ts",
        ),
      },
    },
    optimizeDeps: {
      exclude: ["@aztec/noir-acvm_js", "@aztec/noir-noirc_abi", "@aztec/bb.js"],
      esbuildOptions: { target: esTarget },
    },
    plugins: [
      react({
        jsxImportSource: "@emotion/react",
        // Match esbuild target in dev so async/await gets transpiled for zone.js.
        ...(isDev ? { devTarget: "es2016" as const } : {}),
      }),
      nodePolyfillsFix({ include: ["buffer", "path"] }),
      chunkSizeValidator([
        {
          pattern: /assets\/index-.*\.js$/,
          maxSizeKB: 1700,
          description: "Main entrypoint, hard limit",
        },
        {
          pattern: /.*/,
          maxSizeKB: 8000,
          description: "Detect if json artifacts or bb.js wasm get out of control",
        },
      ]),
    ],
    define: {
      "process.env": JSON.stringify({
        LOG_LEVEL: env.LOG_LEVEL,
      }),
    },
  };
});
