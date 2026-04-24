import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { Plugin } from "vite";
import { nodePolyfills, type PolyfillOptions } from "vite-plugin-node-polyfills";

/**
 * Workaround for https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/81.
 *
 * Rewrites `vite-plugin-node-polyfills/shims/{buffer,global,process}` imports to
 * absolute CJS paths resolved from the actual plugin location — necessary because
 * yarn workspace hoisting can put the plugin above the app root, and the plugin
 * emits relative `./node_modules/...` paths that miss the hoisted copy.
 */
export function nodePolyfillsFix(options?: PolyfillOptions): Plugin {
  const polyfillsDir = dirname(
    dirname(fileURLToPath(import.meta.resolve("vite-plugin-node-polyfills"))),
  );

  return {
    ...nodePolyfills(options),
    resolveId(source: string) {
      const m = /^vite-plugin-node-polyfills\/shims\/(buffer|global|process)$/.exec(source);
      if (m) {
        return join(polyfillsDir, `shims/${m[1]}/dist/index.cjs`);
      }
    },
  };
}
