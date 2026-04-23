import { test as base, expect } from "@playwright/test";

/**
 * Shared `test` with a `page` override that forwards browser-side console
 * output and uncaught errors to the Playwright test runner's stdout.
 *
 * Rationale: most of our failures are app-level (PXE proving errors, sqlite
 * warnings, iframe handshake timeouts) and never surface as assertion
 * failures — the test just hangs until the Playwright per-test timeout fires.
 * Tee-ing `console.{error,warn,info}` + `pageerror` gives us a chance of
 * diagnosing from the CI log alone, without re-running with `--trace on`.
 *
 * Use: `import { test, expect } from "../fixtures/test-base.ts";`
 * Iframe console output (e.g. the bridge iframe inside fpc-operator) routes
 * through the top-level `page.on('console')` automatically — no per-frame
 * wiring needed.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const log = (prefix: string, msg: string) => console.log(`[browser:${prefix}] ${msg}`);

    page.on("console", (msg) => {
      const t = msg.type();
      if (t === "error" || t === "warning" || t === "info") {
        log(t, msg.text());
      }
    });
    page.on("pageerror", (err) => log("pageerror", err.message));

    await use(page);
  },
});

export { expect };
