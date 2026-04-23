import { searchForWorkspaceRoot, type Plugin, type UserConfig } from "vite";
import { nodePolyfillsFix } from "./nodePolyfillsFix.ts";
import { wasmContentTypePlugin } from "./wasmContentTypePlugin.ts";

export type AztecViteBaseOptions = {
  /**
   * Lower esbuild/build target to `es2016` when true. Needed in dev if any
   * downstream profiling tool (e.g. zone.js) hooks `Promise.prototype.then` —
   * V8's fast-await bypass makes native async functions invisible to those
   * hooks. Leave false/default in production for speed.
   */
  es2016?: boolean;
};

/**
 * Shared Vite configuration fragment for all gregojuice apps. Returns only the
 * pieces that are genuinely common — `server`, `optimizeDeps`, `plugins`,
 * `esbuild`, `build`. Apps compose on top with their own `resolve.alias`,
 * `react()`, `define`, `plugins` (chunk validators, etc.).
 *
 * Plugins returned:
 *   - nodePolyfillsFix — buffer/path polyfills with absolute-path workaround.
 *   - wasmContentTypePlugin — sets application/wasm on .wasm responses so
 *     sqlite-wasm (and anything else using compileStreaming) can initialize.
 */
export function aztecViteBase(options: AztecViteBaseOptions = {}): Pick<
  UserConfig,
  "base" | "logLevel" | "esbuild" | "build" | "server" | "optimizeDeps"
> & {
  plugins: Plugin[];
} {
  const target = options.es2016 ? "es2016" : "esnext";

  return {
    base: "./",
    logLevel: process.env.CI ? "error" : undefined,
    esbuild: { target },
    build: { target },
    server: {
      headers: {
        // SharedArrayBuffer requires cross-origin isolation.
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        // Allows this app to be embedded by the wallet iframe / dApp host.
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
      fs: {
        allow: [searchForWorkspaceRoot(process.cwd())],
      },
    },
    optimizeDeps: {
      exclude: [
        // WASM / native-binary assets — must not be pre-bundled.
        "@aztec/noir-acvm_js",
        "@aztec/noir-noirc_abi",
        "@aztec/bb.js",
        // Vite's prebundle extracts the JS into .vite/deps/ but doesn't copy the
        // adjacent sqlite3.wasm binary, so the generated fetch URL 404s. Keeping
        // the JS at its real location puts the .wasm beside it.
        "@sqlite.org/sqlite-wasm",
        // sqlite-opfs does `new Worker(new URL('./worker.js', import.meta.url))`.
        // Vite's workerImportMetaUrlPlugin only runs on source code, not on
        // pre-bundle output — so when this module is bundled, the Worker URL is
        // left verbatim and points at .vite/deps/worker.js which doesn't exist.
        // Excluding keeps it at its real dest/ location where ./worker.js is a sibling.
        "@aztec/kv-store/sqlite-opfs",
      ],
      // Excluding sqlite-opfs detaches its transitive CJS dependencies too
      // (they reach it via @aztec/foundation). Force them back into the
      // pre-bundle so Vite's CJS→ESM interop runs and their named imports
      // (`import { symbols } from 'pino'`, `import { inspect } from 'util'`,
      // `import { Keccak } from 'sha3'`, etc.) keep working.
      include: [
        "pino",
        "pino/browser",
        "sha3",
        "util",
        "lodash.chunk",
        "lodash.clonedeepwith",
      ],
      esbuildOptions: { target },
    },
    plugins: [nodePolyfillsFix({ include: ["buffer", "path"] }), wasmContentTypePlugin()],
  };
}
