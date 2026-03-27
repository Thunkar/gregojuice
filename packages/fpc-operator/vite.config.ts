import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { defineConfig, loadEnv, Plugin, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react-swc";
import { PolyfillOptions, nodePolyfills } from "vite-plugin-node-polyfills";

const polyfillsDir = dirname(dirname(fileURLToPath(import.meta.resolve("vite-plugin-node-polyfills"))));

const nodePolyfillsFix = (options?: PolyfillOptions | undefined): Plugin => {
  return {
    ...nodePolyfills(options),
    /* @ts-ignore */
    resolveId(source: string) {
      const m =
        /^vite-plugin-node-polyfills\/shims\/(buffer|global|process)$/.exec(
          source,
        );
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
      port: 5174,
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
        "@gregojuice/embedded-wallet": resolve(import.meta.dirname, "../embedded-wallet/src/index.ts"),
        "@gregojuice/common": resolve(import.meta.dirname, "../common/src/index.ts"),
        "@gregojuice/contracts/subscription-fpc": resolve(import.meta.dirname, "../contracts/src/subscription-fpc.ts"),
        "@gregojuice/contracts/fpc-gas-constants": resolve(import.meta.dirname, "../contracts/src/fpc-gas-constants.ts"),
        "@gregojuice/contracts/artifacts/SubscriptionFPC": resolve(import.meta.dirname, "../contracts/artifacts/SubscriptionFPC.ts"),
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
