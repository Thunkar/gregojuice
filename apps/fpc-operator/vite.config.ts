import { resolve } from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { aztecViteBase } from "@gregojuice/common/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = aztecViteBase();
  return {
    ...base,
    server: {
      ...base.server,
      port: 5174,
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
    plugins: [...base.plugins, react({ jsxImportSource: "@emotion/react" })],
    define: {
      "process.env": JSON.stringify({
        LOG_LEVEL: env.LOG_LEVEL,
      }),
    },
  };
});
