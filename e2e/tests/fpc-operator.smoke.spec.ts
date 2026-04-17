import { test, expect } from "@playwright/test";

test("fpc-operator app boots", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
