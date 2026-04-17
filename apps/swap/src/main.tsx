// Entry bootstrap.
//
// In dev we load zone.js BEFORE any other module so it can monkey-patch
// Promise/setTimeout/fetch globally. Static ESM imports are hoisted above
// any executable code in a module, so we can't put the zone.js load and
// the rest of the app in the same file — the rest would hoist above zone.js.
//
// Instead, this file conditionally imports zone.js and then dynamically
// imports the real entry. That guarantees zone.js initializes before any
// of the app's module graph starts evaluating.
//
// Zone.js is dev-only: V8's "fast await" optimization bypasses user-space
// Promise.prototype.then, breaking zone propagation unless async/await is
// transpiled (vite.config.ts sets esbuild/SWC target to es2016 in dev).
// Prod runs with esnext and no profiler — zone.js isn't included.

async function boot() {
  if (import.meta.env.DEV) {
    await import("zone.js");
    const Zone = (globalThis as any).Zone;
    // eslint-disable-next-line no-console
    console.info(
      "[profiler] zone.js loaded:",
      Zone && Zone.current ? `ok (root zone: ${Zone.current.name})` : "FAILED",
    );
  }
  await import("./app-entry");
}

void boot();
