import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "path";
import { aztecViteBase, chunkSizeValidator } from "@gregojuice/common/vite";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Profiling (zone.js-based async context tracking) runs only in dev.
  // V8's "fast await" optimization bypasses user-space Promise.prototype.then
  // for native `async function` bodies, breaking zone.js propagation. Lowering
  // the esbuild/SWC target to es2016 in dev forces async/await to be transpiled
  // to Promise-based state machines that DO go through user-level .then() —
  // which zone.js can hook. Prod keeps esnext for speed.
  const isDev = command === "serve";
  const base = aztecViteBase({ es2016: isDev });

  return {
    ...base,
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
    plugins: [
      ...base.plugins,
      react({
        jsxImportSource: "@emotion/react",
        // Match esbuild target in dev so async/await gets transpiled for zone.js.
        ...(isDev ? { devTarget: "es2016" as const } : {}),
      }),
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
