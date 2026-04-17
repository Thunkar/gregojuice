import { test, expect } from "@playwright/test";

test("swap app boots", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
