import { expect, test } from "@playwright/test";
import path from "node:path";
import { signIn } from "./helpers";

/** Captures every major screen of the synthetic demo for docs/screenshots. Run with SCREENSHOTS=1. */
const OUT = path.resolve(__dirname, "../../docs/screenshots");
test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to capture documentation screenshots");
test.use({ deviceScaleFactor: 2 });

test("capture screens", async ({ page, browser }) => {
  await page.goto("/login");
  await page.screenshot({ path: `${OUT}/01-login.png` });
  await signIn(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/02-dashboard.png`, fullPage: true });
  await page.getByRole("link", { name: "Mesquite Crossing (Synthetic)" }).first().click();
  await expect(page.getByText("Audit readiness")).toBeVisible();
  const base = page.url();
  await page.screenshot({ path: `${OUT}/03-property-overview.png`, fullPage: true });
  const shots: [string, string, string][] = [
    ["tenants", "Lease term", "04-tenants"],
    ["import", "Import history", "05-import-wizard"],
    ["mapping", "Supporting transactions", "06-expense-mapping"],
    ["rules", "Lease source", "07-lease-rules"],
    ["audit", "Tenant reconciliation", "08-audit-workspace"],
    ["exceptions", "Needs action", "10-exceptions"],
    ["reports", "Run details", "12-reports"],
  ];
  for (const [slug, wait, file] of shots) {
    await page.goto(`${base}/${slug}`);
    await expect(page.getByText(wait).first()).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
  }
  await page.goto(`${base}/audit`);
  await page.getByRole("row", { name: /Guadalupe/ }).click();
  await expect(page.getByText("Provisional calculated amount")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/09-calculation-trace.png` });
  await page.keyboard.press("Escape");
  await page.goto(`${base}/exceptions`);
  await page.getByRole("row", { name: /DUPLICATE_GL_CANDIDATE/ }).click();
  await expect(page.getByText("How to clear it")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/11-exception-detail.png` });
  await page.keyboard.press("Escape");
  await page.goto(`${base}/import`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.screenshot({ path: `${OUT}/13-import-upload-step.png` });
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/14-command-palette.png` });
  await page.keyboard.press("Escape");

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await mobile.context().addCookies(await page.context().cookies());
  await mobile.goto(`${base}/audit`);
  await expect(mobile.getByText("Tenant reconciliation")).toBeVisible();
  await mobile.waitForTimeout(500);
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mobile.screenshot({ path: `${OUT}/15-mobile-audit.png`, fullPage: true });
});
