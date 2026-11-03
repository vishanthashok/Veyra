import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Full workflow on a brand-new property: create it, add a period, category and tenant, import a
 * GL through the wizard, review the mapping, create and approve a lease rule, import billings,
 * run the audit, inspect the trace and accept a blocking exception with a note.
 * Expected figures are hand-computed in comments.
 */
test("new property from import to reviewed audit", async ({ page }) => {
  const name = `E2E Plaza ${Date.now()}`;
  await signIn(page);

  await page.goto("/properties?new=1");
  const dlg = page.getByRole("dialog", { name: "New property" });
  await dlg.getByLabel("Name").fill(name);
  await dlg.getByRole("button", { name: "Create property" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByRole("button", { name: "Add period" }).click();
  const pd = page.getByRole("dialog", { name: "Add reporting period" });
  await pd.getByLabel("Label").fill("FY2026 YTD");
  await pd.getByLabel("Fiscal year start").fill("2026-01-01");
  await pd.getByLabel("Fiscal year end").fill("2026-12-31");
  await pd.getByLabel("Through date").fill("2026-09-30");
  await pd.getByRole("button", { name: "Add period" }).click();
  await expect(page.getByRole("cell", { name: "FY2026 YTD" })).toBeVisible();

  await page.getByRole("button", { name: "Add category" }).click();
  const cd = page.getByRole("dialog", { name: "Add expense category" });
  await cd.getByLabel("Code").fill("LAND");
  await cd.getByLabel("Name").fill("Landscaping");
  await cd.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByRole("cell", { name: "LAND", exact: true })).toBeVisible();

  const base = page.url();
  await page.goto(`${base}/tenants`);
  await page.getByRole("button", { name: "Add tenant" }).first().click();
  const td = page.getByRole("dialog", { name: "Add tenant" });
  await td.getByLabel("Tenant name").fill("Mesa Bakery");
  await td.getByLabel("Suite").fill("101");
  await td.getByLabel("Rentable sq ft").fill("2000");
  await td.getByLabel("Lease start").fill("2020-01-01");
  await td.getByRole("button", { name: "Add tenant" }).click();
  await expect(page.getByRole("cell", { name: "Mesa Bakery", exact: true })).toBeVisible();

  // GL import through the wizard: 10,000.00 landscaping plus one invalid row.
  await page.goto(`${base}/import`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "gl.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Account,Account Name,Date,Amount,Memo/Description\n6100,Landscaping,2026-03-05,6000.00,Mar grounds\n6100,Landscaping,2026-06-05,4000.00,Jun grounds\n6100,Landscaping,not-a-date,1.00,bad row\n",
    ),
  });
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await page.getByRole("button", { name: "Validate rows" }).click();
  await expect(page.getByText("Will be imported")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Unrecognized date/ })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue to confirm" }).click();
  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByText("Import committed")).toBeVisible();

  // Mapping review.
  await page.goto(`${base}/mapping`);
  await page.getByRole("radio", { name: /^Recoverable/ }).check();
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("LAND");
  await page.getByLabel("Explanation").fill("Common area landscaping, lease 6.1");
  await page.getByRole("button", { name: "Save decision" }).click();
  await expect(page.getByText("All reviewed")).toBeVisible();

  // Lease rule: pro-rata 2,000 / 10,000 = 20%.
  await page.goto(`${base}/rules`);
  await page.getByRole("button", { name: "New rule" }).first().click();
  const rd = page.getByRole("dialog", { name: "New lease rule" });
  await rd.getByLabel("Rule reference").fill("LR-101");
  await rd.getByLabel("Denominator sq ft").fill("10000");
  await rd.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Review and approve" }).click();
  const ad = page.getByRole("dialog", { name: "Approve LR-101" });
  for (const box of await ad.getByRole("checkbox").all()) await box.check();
  await ad.getByLabel("Approval note").fill("Checked against synthetic lease page 4");
  await ad.getByRole("button", { name: "Approve rule" }).click();
  await expect(page.getByText("All approved")).toBeVisible();

  await page.goto(`${base}/tenants`);
  await page.getByRole("button", { name: "Edit Mesa Bakery" }).click();
  await page.getByRole("dialog").getByLabel("Lease rule").selectOption({ label: "LR-101 (approved)" });
  await page.getByRole("button", { name: "Save tenant" }).click();
  await expect(page.getByText("LR-101")).toBeVisible();

  // Billings: 9 x 200 = 1,800.
  await page.goto(`${base}/import`);
  await page.getByRole("tab", { name: "Tenant billings" }).click();
  const bill = ["Tenant,Bill Date,Amount", ...Array.from({ length: 9 }, (_, i) => `101,2026-0${i + 1}-01,200.00`)].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "billings.csv", mimeType: "text/csv", buffer: Buffer.from(bill) });
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await page.getByRole("button", { name: "Validate rows" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue to confirm" }).click();
  await page.getByRole("button", { name: "Import 9 rows" }).click();
  await expect(page.getByText("Import committed")).toBeVisible();

  // Audit: 10,000 x 20% = 2,000.00; billed 1,800.00; variance 200.00.
  await page.goto(`${base}/audit`);
  await page
    .getByRole("button", { name: /Run (first )?audit/ })
    .first()
    .click();
  const row = page.getByRole("row", { name: /Mesa Bakery/ });
  await expect(row).toContainText("2,000.00");
  await expect(row).toContainText("1,800.00");
  await expect(row).toContainText("200.00");
  await expect(row).toContainText("Under-billed");
  await row.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Provisional calculated amount")).toBeVisible();
  await expect(sheet.getByText("20.0000% of 10,000.00")).toBeVisible();
  await page.keyboard.press("Escape");

  const v = page.getByRole("button", { name: "Verify" });
  await v.click();
  await expect(page.getByText(/Reproducible/)).toBeVisible();
});

test("blocking errors can be accepted with a note but not resolved by hand", async ({ page }) => {
  await signIn(page);
  const props: { id: string; name: string }[] = await page.evaluate(() => fetch("/api/v1/properties").then((r) => r.json()));
  const base = `/properties/${props.find((p) => p.name === "Mesquite Crossing (Synthetic)")!.id}`;
  // A fresh run gives a fresh queue, so the test does not depend on earlier decisions.
  await page.goto(`${base}/audit`);
  await page.getByRole("button", { name: "Run audit" }).click();
  await expect(page.getByText(/Audit complete/)).toBeVisible();
  await page.goto(`${base}/exceptions`);
  await page.getByRole("button", { name: /Missing lease rule/ }).click();
  const detail = page.getByRole("main");
  await expect(detail.getByText("cannot be marked resolved by hand")).toBeVisible();
  await expect(detail.getByRole("button", { name: "Resolve", exact: true })).toHaveCount(0);
  await detail.getByRole("button", { name: "Accept exception" }).click();
  const note = page.getByRole("dialog", { name: "Accept exception" });
  await note.getByRole("button", { name: "Accept exception" }).click();
  await expect(note.getByRole("alert")).toContainText("Write at least a few words");
  await note.getByLabel(/Reviewer note/).fill("Tenant vacates Oct 31; owner excludes from 2026 pre-close review");
  await note.getByRole("button", { name: "Accept exception" }).click();
  // Accepted items leave the action queue but stay on the record.
  await page.getByRole("tab", { name: /Closed/ }).click();
  await page.getByRole("button", { name: /Missing lease rule/ }).click();
  await expect(detail.getByText("Tenant vacates Oct 31").first()).toBeVisible();
  await expect(detail.getByRole("button", { name: "Reopen" })).toBeVisible();
});

test("keyboard: skip link and command palette", async ({ page }) => {
  await signIn(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("mesquite");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Mesquite Crossing (Synthetic)" })).toBeVisible();
});
