import { type Page, expect, test } from "@playwright/test";
import path from "node:path";
import { signIn } from "./helpers";

/** Captures every major screen of the synthetic demo for docs/screenshots. Run with SCREENSHOTS=1. */
const OUT = path.resolve(__dirname, "../../docs/screenshots");
test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to capture documentation screenshots");
test.use({ deviceScaleFactor: 2 });

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("capture screens", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await page.goto("/login");
  await page.screenshot({ path: `${OUT}/01-login.png` });
  await signIn(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/02-overview.png`, fullPage: true });
  const props = await page.evaluate(() => fetch("/api/v1/properties").then((r) => r.json()));
  const base = `/properties/${props[0].id}`;
  const shots: [string, string, string][] = [
    ["", "Audit readiness", "03-property-setup"],
    ["/tenants", "Lease term", "04-tenants"],
    ["/import", "Import history", "05-import"],
    ["/mapping", "Supporting transactions", "06-expense-mapping"],
    ["/rules", "Lease source", "07-lease-rules"],
    ["/audit", "Tenant reconciliation", "08-audit-workspace"],
    ["/exceptions", "How to clear it", "10-exceptions"],
    ["/reports", "Run details", "12-reports"],
  ];
  for (const [slug, wait, file] of shots) {
    await page.goto(`${base}${slug}`);
    await expect(page.getByText(wait).first()).toBeVisible();
    await page.waitForTimeout(500);
    await noOverflow(page);
    await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
  }
  await page.goto(`${base}/audit`);
  await page.getByRole("row", { name: /Guadalupe/ }).click();
  await expect(page.getByText("Provisional calculated amount")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/09-calculation-trace.png` });
  await page.keyboard.press("Escape");

  await page.goto(`${base}/import`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "gl-october.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Account,Account Name,Date,Amount,Memo/Description\n6100,Landscaping,2026-10-05,2400.00,Oct grounds\n6110,Janitorial,10/05/2026,1850.00,Oct porter\n6120,Parking Lot,2026-13-01,950.00,bad date\n6130,Common Utilities,2026-10-20,,missing amount\n",
    ),
  });
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await expect(page.getByRole("button", { name: "Validate rows" })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/13-import-map-columns.png` });
  await page.getByRole("button", { name: "Validate rows" }).click();
  await expect(page.getByText("Will be imported")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/14-import-validate.png` });
  await page.getByRole("button", { name: "Cancel import" }).click();

  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/16-command-palette.png` });
  await page.keyboard.press("Escape");

  const cookies = await page.context().cookies();
  for (const [w, h, name] of [
    [1280, 800, "laptop-1280"],
    [768, 1024, "tablet-768"],
    [390, 844, "mobile-390"],
  ] as const) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await p.context().addCookies(cookies);
    for (const [slug, wait, file] of [
      ["/", "Action center", "overview"],
      [`${base}/audit`, "Tenant reconciliation", "audit"],
      [`${base}/exceptions`, "How to clear it", "exceptions"],
    ] as const) {
      await p.goto(slug);
      await expect(p.getByText(wait).first()).toBeVisible();
      await p.waitForTimeout(500);
      await noOverflow(p);
      await p.screenshot({ path: `${OUT}/viewport-${name}-${file}.png`, fullPage: true });
    }
    await p.close();
  }
});
