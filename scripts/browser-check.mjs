import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let promptValue = "5000",
  rejectConfirm = false;
page.on("dialog", async (dialog) => {
  if (dialog.type() === "prompt") await dialog.accept(promptValue);
  else if (dialog.type() === "confirm" && rejectConfirm) await dialog.dismiss();
  else await dialog.accept();
});
try {
  await page.goto("http://127.0.0.1:5173");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1000;
    c.height = 600;
    const x = c.getContext("2d");
    x.fillStyle = "#fff";
    x.fillRect(0, 0, 1000, 600);
    x.strokeStyle = "#58636b";
    x.lineWidth = 8;
    x.strokeRect(10, 10, 980, 580);
    x.lineWidth = 2;
    x.strokeRect(500, 10, 490, 200);
    x.fillStyle = "#555";
    x.font = "18px sans-serif";
    x.fillText("WORKSHOP / 10,000 × 6,000 mm", 30, 40);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .locator("#image-file")
    .setInputFiles({
      name: "workshop.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
  await page.getByText("縮尺の設定が必要", { exact: true }).waitFor();
  await page.locator("#calibrate").click();
  async function clickWorld(x, y) {
    const point = await page.locator("#canvas").evaluate(
      (svg, { x, y }) => {
        const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM());
        return { x: p.x, y: p.y };
      },
      { x, y },
    );
    await page.mouse.click(point.x, point.y);
  }
  await clickWorld(100, 100);
  await clickWorld(600, 100);
  await page.getByText("校正済み", { exact: true }).waitFor();
  await page.locator("#origin").click();
  await clickWorld(100, 100);
  await page.locator("#add").click();
  await page.locator("#name").fill("加工機 A");
  await page.locator("#name").press("Tab");
  await page.locator("#x").fill("1000");
  await page.locator("#x").press("Tab");
  await page.locator("#y").fill("1000");
  await page.locator("#y").press("Tab");
  await page.locator("#width").fill("1200");
  await page.locator("#width").press("Tab");
  await page.locator("#duplicate-stage").click();
  await page.locator("#x").fill("3000");
  await page.locator("#x").press("Tab");
  await page.locator("#name").fill("加工機 A（共通）");
  await page.locator("#name").press("Tab");
  await page.locator("#tracks thead button").first().click();
  assert.equal(await page.locator("#x").inputValue(), "1000");
  assert.equal(await page.locator("#name").inputValue(), "加工機 A（共通）");
  await page.locator("#tracks thead button").nth(1).click();
  assert.equal(await page.locator("#x").inputValue(), "3000");
  await page.locator("#duplicate-stage").click();
  await page.locator("#remove").click();
  await page.getByText("この時点では不在", { exact: true }).waitFor();
  await page.locator("#place").click();
  await clickWorld(2000, 2000);
  assert.equal(await page.locator("#x").inputValue(), "1900");
  await page.locator("#copy").click();
  assert.equal(await page.locator("#tracks tbody tr").count(), 2);
  await page.locator("#fixed").click();
  await page.locator("#add").click();
  await page.locator("#name").fill("柱");
  await page.locator("#name").press("Tab");
  assert.equal(await page.locator("#tracks tbody tr").count(), 2);
  await page.locator("#x").fill("-500");
  await page.locator("#x").press("Tab");
  await page.locator("#fixed").click();
  await page
    .locator("#tracks tbody tr")
    .first()
    .locator("button")
    .nth(2)
    .click();
  const before = await page.locator("#x").inputValue();
  const entity = page.locator('#canvas [data-fixed="false"]').first();
  const rect = await entity.boundingBox();
  await page.mouse.move(rect.x + 10, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(rect.x + 60, rect.y + 40, { steps: 5 });
  await page.mouse.up();
  const after = await page.locator("#x").inputValue();
  assert.notEqual(after, before);
  await page.locator("#undo").click();
  assert.equal(await page.locator("#x").inputValue(), before);
  await page.locator("#redo").click();
  assert.equal(await page.locator("#x").inputValue(), after);
  const saved = page.waitForEvent("download");
  await page.locator("#save").click();
  const download = await saved;
  const content = await readFile(await download.path(), "utf8");
  const project = JSON.parse(content);
  assert.equal(project.stages.length, 3);
  assert.equal(project.entities.length, 2);
  assert.equal(project.fixed.length, 1);
  assert.ok(Math.abs(project.background.mmPerPixel - 10) < 1e-8);
  assert.equal(await page.locator("#dirty").innerText(), "保存済み");
  await page
    .locator("#project-file")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"version":900}'),
    });
  await page.waitForTimeout(150);
  assert.equal(await page.locator("#tracks tbody tr").count(), 2);
  await page.locator("#name").fill("未保存変更");
  await page.locator("#name").press("Tab");
  rejectConfirm = true;
  await page.locator("#new").click();
  assert.equal(await page.locator("#tracks tbody tr").count(), 2);
  rejectConfirm = false;
  await page
    .locator("#project-file")
    .setInputFiles({
      name: "saved.json",
      mimeType: "application/json",
      buffer: Buffer.from(content),
    });
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#tracks tbody tr").count(), 2);
  assert.equal(await page.locator("#dirty").innerText(), "保存済み");
  await page.locator("#tracks thead button").nth(2).click();
  const exported = page.waitForEvent("download");
  await page.locator("#export").click();
  const pngDownload = await exported;
  const output = await readFile(await pngDownload.path());
  assert.equal(output.subarray(1, 4).toString(), "PNG");
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/layout.png", output);
  await page.screenshot({ path: "artifacts/editor.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: calibration, origin, shared properties, 3 stages, removal/reappearance, fixed objects, drag undo/redo, JSON round trip, invalid import, unsaved confirmation, PNG export; no browser errors.",
  );
} finally {
  await browser.close();
}
