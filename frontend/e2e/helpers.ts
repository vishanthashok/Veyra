import { type Page, expect } from "@playwright/test";

export const DEMO = { email: "demo@veyra.local", password: process.env.VEYRA_DEMO_PASSWORD ?? "veyra-demo-2026" };

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
}
