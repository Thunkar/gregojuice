import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { defineConfig, loadEnv, Plugin, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react-swc";
import { PolyfillOptions, nodePolyfills } from "vite-plugin-node-polyfills";

const polyfillsDir = dirname(
  dirname(fileURLToPath(import.meta.resolve("vite-plugin-node-polyfills"))),
);

const nodePolyfillsFix = (options?: PolyfillOptions | undefined): Plugin => {
  return {
    ...nodePolyfills(options),
    /* @ts-expect-error viem typing mismatch with vite-plugin-node-polyfills */
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
        "@gregojuice/embedded-wallet/ui": resolve(
          import.meta.dirname,
          "../../packages/embedded-wallet/src/ui.ts",
        ),
        "@gregojuice/embedded-wallet": resolve(
          import.meta.dirname,
          "../../packages/embedded-wallet/src/index.ts",
        ),
        "@gregojuice/common/ui": resolve(
          import.meta.dirname,
          "../../packages/common/src/ui/index.ts",
        ),
        "@gregojuice/common/bridging": resolve(
          import.meta.dirname,
          "../../packages/common/src/bridging/index.ts",
        ),
        "@gregojuice/common/fees": resolve(
          import.meta.dirname,
          "../../packages/common/src/fees/index.ts",
        ),
        "@gregojuice/common/testing": resolve(
          import.meta.dirname,
          "../../packages/common/src/testing/index.ts",
        ),
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
