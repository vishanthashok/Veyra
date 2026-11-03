import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("overview leads with actions that open the right workflow", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run audit" })).toBeEnabled();
  const center = page.getByRole("region", { name: "Action center" }).or(page.locator("section[aria-labelledby=action-center]"));
  await center.getByRole("link", { name: /GL account needs classification/ }).click();
  await expect(page.getByRole("heading", { name: "Expense mapping" })).toBeVisible();
});

test("sidebar groups, active state and collapse", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const label of [
    "Overview",
    "Properties",
    "Data imports",
    "Expense mapping",
    "Lease rules",
    "Audit workspace",
    "Exceptions",
    "Reports",
  ]) {
    await expect(nav.getByRole("link", { name: new RegExp(label) })).toBeVisible();
  }
  await nav.getByRole("link", { name: /Audit workspace/ }).click();
  await expect(nav.getByRole("link", { name: /Audit workspace/ })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
});

test("mobile navigation opens as a drawer", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(page);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /Properties/ })
    .click();
  await expect(page.getByRole("heading", { name: "Properties", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.close();
});
