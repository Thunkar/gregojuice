import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { defineConfig, loadEnv, Plugin, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react-swc";
import { PolyfillOptions, nodePolyfills } from "vite-plugin-node-polyfills";

// Resolve the actual location of vite-plugin-node-polyfills (may be hoisted to root node_modules)
const polyfillsDir = dirname(
  dirname(fileURLToPath(import.meta.resolve("vite-plugin-node-polyfills"))),
);

// Workaround for https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/81
const nodePolyfillsFix = (options?: PolyfillOptions | undefined): Plugin => {
  return {
    ...nodePolyfills(options),
    /* @ts-ignore */
    resolveId(source: string) {
      const m = /^vite-plugin-node-polyfills\/shims\/(buffer|global|process)$/.exec(source);
      if (m) {
        return join(polyfillsDir, `shims/${m[1]}/dist/index.cjs`);
      }
    },
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: "./",
    logLevel: process.env.CI ? "error" : undefined,
    server: {
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "cross-origin",
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
        "@gregojuice/common": resolve(import.meta.dirname, "../../packages/common/src/index.ts"),
        "@gregojuice/ethereum": resolve(
          import.meta.dirname,
          "../../packages/ethereum/generated/bridge-contract-artifacts.ts",
        ),
      },
    },
    optimizeDeps: {
      exclude: ["@aztec/noir-acvm_js", "@aztec/noir-noirc_abi", "@aztec/bb.js"],
    },
    plugins: [
      react({ jsxImportSource: "@emotion/react" }),
      nodePolyfillsFix({ include: ["buffer", "path"] }),
    ],
    define: {
      "process.env": JSON.stringify({
        LOG_LEVEL: env.LOG_LEVEL,
      }),
    },
  };
});
