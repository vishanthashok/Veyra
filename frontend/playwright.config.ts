import { defineConfig } from "@playwright/test";

/**
 * E2E tests run against a live stack: FastAPI on :8000 with a migrated database seeded by
 * `python -m app.demo_seed`, and `pnpm start` on :3000. CI starts both (see .github/workflows/ci.yml).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure", viewport: { width: 1440, height: 900 } },
});
