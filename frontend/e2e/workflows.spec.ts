import path from "node:path";
import { type Locator, type Page, expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const EX = path.resolve(__dirname, "../../demo/workflows");

async function connect(page: Page, from: [string, string], to: [string, string]) {
  const src = page.locator(`.react-flow__handle[data-nodeid="${from[0]}"][data-handleid="${from[1]}"]`);
  const dst = page.locator(`.react-flow__handle[data-nodeid="${to[0]}"][data-handleid="${to[1]}"]`);
  const a = (await src.boundingBox())!;
  const b = (await dst.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function dropStep(page: Page, label: string, at: { x: number; y: number }) {
  const canvas = page.getByLabel("Workflow canvas");
  await page.getByRole("button", { name: `Add ${label}` }).dragTo(canvas, { targetPosition: at });
}

async function waitForRunEnd(page: Page) {
  await expect(page.getByRole("heading", { name: /Run of/ })).toBeVisible();
  const header = page.locator("header").filter({ has: page.getByRole("heading", { name: /Run of/ }) });
  await expect(header.getByText(/Completed|Awaiting approval|Failed/).first()).toBeVisible({ timeout: 20_000 });
  return header;
}

function stepNode(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

test("create a workflow, add steps, run it, review, download, rerun with a new file", async ({ page }) => {
  const name = `GL cleaner ${Date.now()}`;
  await signIn(page);

  // 1. Create from the template.
  await page.getByRole("link", { name: "Workflows" }).click();
  await expect(page.getByRole("heading", { name: "Workflows", level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: /Templates/ }).click();
  await page.getByRole("button", { name: "Use template GL expense cleaner" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create workflow" }).click();
  await expect(page.getByLabel("Workflow canvas")).toBeVisible();
  await expect(page.getByLabel("Workflow name")).toHaveValue(name);
  await expect(page.getByText("No problems. The workflow can run.")).toBeVisible();

  // 2-3. Add processing steps: filter large amounts and export them.
  await page.getByRole("button", { name: "Fit View" }).click();
  await dropStep(page, "Filter rows", { x: 420, y: 420 });
  await expect(stepNode(page, "filter1")).toBeVisible();
  await expect(page.getByText(/connect a step to 'Rows'/).first()).toBeVisible();
  await page.getByRole("button", { name: "Add condition" }).click();
  await page.getByLabel("Condition 1 column").fill("amount");
  await page.getByLabel("Condition 1 operator").selectOption("gte");
  await page.getByLabel("Condition 1 value").fill("1000");
  await page.getByLabel("Condition 1 type").selectOption("number");
  await page.getByLabel("Step name").fill("Amounts over 1,000");
  await dropStep(page, "CSV export", { x: 640, y: 420 });
  await expect(stepNode(page, "csv1")).toBeVisible();
  await page.getByLabel("File name").fill("large-amounts.csv");
  await connect(page, ["dedupe", "out"], ["filter1", "in"]);
  await connect(page, ["filter1", "out"], ["csv1", "in"]);
  await expect(page.getByText("No problems. The workflow can run.")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved as version 2")).toBeVisible();

  // 4. Upload a spreadsheet and run.
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.getByLabel("File for General ledger (CSV or XLSX)").setInputFiles(path.join(EX, "gl_export_messy.csv"));
  await expect(page.getByRole("dialog").getByText("Showing 6 of 11 rows.")).toBeVisible();
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.locator("section[aria-label='Run output']").getByText("Completed").first()).toBeVisible({ timeout: 20_000 });
  await expect(stepNode(page, "filter1")).toContainText("rows");

  // 5. Review results.
  await page.getByRole("link", { name: /Last run/ }).click();
  await waitForRunEnd(page);
  const issues = page.getByRole("table", { name: "Errors and warnings" });
  await expect(issues.getByText("INVALID_DATE")).toBeVisible();
  await expect(issues.getByText("DUPLICATE_ROW")).toBeVisible();
  await page.getByRole("button", { name: /Normalize values/ }).click();
  await page.getByRole("tab", { name: /rejected/ }).click();
  await expect(
    page
      .getByRole("table", { name: /Normalize values rejected rows/ })
      .getByText("not a date")
      .first(),
  ).toBeVisible();

  // 6. Download the output workbook and the new CSV.
  const [xlsx] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download gl-cleaned.xlsx" }).click()]);
  expect(xlsx.suggestedFilename()).toBe("gl-cleaned.xlsx");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download large-amounts.csv" }).click()]);
  const text = await (await csv.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(text).toContain("4500.00"); // roof repair passes the >= 1000 filter
  expect(text).not.toContain("975.50");

  // 7. Rerun the saved workflow with a new file.
  await page.getByRole("button", { name: "Run with new files" }).click();
  await page.getByLabel("File for General ledger (CSV or XLSX)").setInputFiles(path.join(EX, "gl_export_march.csv"));
  await page.getByRole("button", { name: "Run now" }).click();
  const header = await waitForRunEnd(page);
  await expect(header.getByText("Completed")).toBeVisible();
  await expect(page.getByText("gl_export_march.csv")).toBeVisible();
  await expect(page.getByRole("table", { name: "Errors and warnings" })).toHaveCount(0);
  await expect(page.getByText("No errors or warnings.")).toBeVisible();
});

test("approval gate pauses the pre-close template until a reviewer approves", async ({ page }) => {
  await signIn(page);
  await page.goto("/workflows?tab=templates");
  await page.getByRole("button", { name: "Use template CAM pre-close readiness" }).click();
  await page.getByLabel("Name").fill(`Pre-close ${Date.now()}`);
  await page.getByRole("combobox", { name: /Property/ }).selectOption({ label: "Mesquite Crossing (Synthetic)" });
  await page.getByRole("button", { name: "Create workflow" }).click();
  await expect(page.getByText("No problems. The workflow can run.")).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("dialog").getByText(/reads Veyra property data only/)).toBeVisible();
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.locator("section[aria-label='Run output']").getByText("Awaiting approval").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: /Last run/ }).click();
  await waitForRunEnd(page);
  const banner = page.getByRole("region", { name: "Approval required" });
  await expect(banner).toContainText("Reviewer sign-off");
  await expect(page.getByText("Files appear when the output steps finish.")).toBeVisible();
  await banner.getByRole("button", { name: "Approve and continue" }).click();
  const dlg = page.getByRole("dialog", { name: "Approve and continue" });
  await dlg.getByLabel(/Reviewer note/).fill("Reviewed blocked tenants with the owner");
  await dlg.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("link", { name: "Download cam-preclose-readiness.xlsx" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Download cam-preclose-exceptions.xlsx" })).toBeVisible();
});
