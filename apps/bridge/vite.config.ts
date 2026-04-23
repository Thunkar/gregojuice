import { resolve } from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { aztecViteBase } from "@gregojuice/common/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = aztecViteBase();
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
        "@gregojuice/ethereum": resolve(
          import.meta.dirname,
          "../../packages/contracts/ethereum/lib/deterministic.ts",
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
