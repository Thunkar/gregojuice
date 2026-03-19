import { defineConfig, loadEnv, Plugin, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react-swc";
import { PolyfillOptions, nodePolyfills } from "vite-plugin-node-polyfills";

// Workaround for https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/81
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
        return `./node_modules/vite-plugin-node-polyfills/shims/${m[1]}/dist/index.cjs`;
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
      },
      fs: {
        allow: [searchForWorkspaceRoot(process.cwd())],
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
