import { test, expect } from "@playwright/test";

test("bridge app boots", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
