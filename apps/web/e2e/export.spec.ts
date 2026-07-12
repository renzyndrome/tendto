import { readFileSync } from "node:fs";

import type { Download } from "@playwright/test";

import { expect, test } from "./fixtures";

/**
 * Phase 3 — workspace export. "Export" downloads the workspace as JSON + Markdown, and the JSON
 * contains the content that was created.
 */
test.describe("export", () => {
  test("exports the workspace as JSON and Markdown", async ({ authedPage: page }) => {
    const marker = `export-${Date.now().toString(36)}`;

    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();
    await editor.pressSequentially(marker);
    await page.waitForTimeout(1500); // persist to the replica (export reads the replica)

    const downloads: Download[] = [];
    page.on("download", (d) => downloads.push(d));
    await page.getByRole("button", { name: "Export" }).click();

    await expect.poll(() => downloads.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    const names = downloads.map((d) => d.suggestedFilename());
    expect(names).toContain("tendto-export.json");
    expect(names).toContain("tendto-export.md");

    const jsonDownload = downloads.find((d) => d.suggestedFilename().endsWith(".json"));
    const path = await jsonDownload!.path();
    const content = readFileSync(path, "utf8");
    expect(content).toContain(marker); // the exported block content includes what we typed
    const parsed = JSON.parse(content) as { pages: unknown[]; blocks: unknown[] };
    expect(Array.isArray(parsed.pages)).toBe(true);
    expect(parsed.blocks.length).toBeGreaterThan(0);
  });
});
