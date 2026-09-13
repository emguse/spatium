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
  await page.locator("#image-file").setInputFiles({
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
  async function field(id, value) {
    await page.locator("#" + id).fill(value);
    await page.locator("#" + id).press("Tab");
  }
  async function date(value) {
    await field("selected-date", value);
  }
  async function saveProject() {
    const saved = page.waitForEvent("download");
    await page.locator("#save").click();
    return JSON.parse(await readFile(await (await saved).path(), "utf8"));
  }
  await date("2026-10-01");
  await page.locator("#add").click();
  await field("name", "加工機 A");
  await field("x", "1000");
  await field("y", "1000");
  await field("width", "1200");
  assert.equal(await page.locator("#start-date").inputValue(), "2026-10-01");
  assert.equal(await page.locator("#end-date").inputValue(), "");
  assert.equal(await page.locator("#remove-keyframe").isDisabled(), true);
  await date("2026-10-08");
  await field("x", "3000");
  await date("2026-10-15");
  await field("x", "5000");
  await date("2026-10-10");
  await field("x", "3500");
  await field("name", "加工機 A（共通）");
  await date("2026-10-07");
  assert.equal(await page.locator("#x").inputValue(), "1000");
  assert.equal(await page.locator("#name").inputValue(), "加工機 A（共通）");
  await date("2026-10-09");
  assert.equal(await page.locator("#x").inputValue(), "3000");
  await date("2026-10-14");
  assert.equal(await page.locator("#x").inputValue(), "3500");
  await date("2026-10-15");
  assert.equal(await page.locator("#x").inputValue(), "5000");
  await field("end-date", "2026-10-20");
  await date("2026-10-20");
  assert.equal(await page.locator('#canvas [data-fixed="false"]').count(), 1);
  await date("2026-10-21");
  assert.equal(await page.locator('#canvas [data-fixed="false"]').count(), 0);
  assert.equal(await page.locator("#x").isDisabled(), true);
  assert.equal(await page.locator("#copy").isDisabled(), true);
  await field("end-date", "");
  assert.equal(await page.locator('#canvas [data-fixed="false"]').count(), 1);
  await field("end-date", "2026-10-20");
  await date("2026-10-10");
  await page.locator("#remove-keyframe").click();
  assert.equal(await page.locator("#x").inputValue(), "3000");
  await page.locator("#undo").click();
  assert.equal(await page.locator("#x").inputValue(), "3500");
  await page.locator("#redo").click();
  assert.equal(await page.locator("#x").inputValue(), "3000");
  await field("end-date", "2026-10-09");
  assert.equal(await page.locator("#end-date").inputValue(), "2026-10-20");
  await field("start-date", "2026-10-08");
  assert.equal(await page.locator("#start-date").inputValue(), "2026-10-01");
  await field("start-date", "2026-10-02");
  await date("2026-10-01");
  assert.equal(await page.locator("#x").isDisabled(), true);
  await date("2026-10-02");
  assert.equal(await page.locator("#x").inputValue(), "1000");
  await date("2026-10-10");
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
  await page.locator("#copy").click();
  assert.equal(await page.locator("#tracks tbody tr").count(), 2);
  assert.equal(await page.locator("#start-date").inputValue(), "2026-10-10");
  assert.equal(await page.locator("#end-date").inputValue(), "");
  await page.locator("#end-here").click();
  assert.equal(await page.locator("#end-date").inputValue(), "2026-10-10");
  await page.locator("#fixed").click();
  await page.locator("#add").click();
  await field("name", "柱");
  await field("x", "-500");
  assert.equal(await page.locator("#tracks tbody tr").count(), 2);
  await date("2026-09-01");
  assert.equal(await page.locator('#canvas [data-fixed="true"]').count(), 1);
  assert.equal(await page.locator('#canvas [data-fixed="false"]').count(), 0);
  await page.locator("#fixed").click();
  await page
    .locator("#tracks tbody tr")
    .first()
    .locator('[data-date="2026-10-10"]')
    .click();
  rejectConfirm = true;
  await page.locator("#remove").click();
  assert.equal(await page.locator("#tracks tbody tr").count(), 2);
  rejectConfirm = false;
  await page.locator("#remove").click();
  assert.equal(await page.locator("#tracks tbody tr").count(), 1);
  await page.locator("#undo").click();
  assert.equal(await page.locator("#tracks tbody tr").count(), 2);
  const project = await saveProject();
  const content = JSON.stringify(project);
  assert.equal(project.version, 2);
  assert.equal(project.stages, undefined);
  assert.equal(project.entities.length, 2);
  assert.equal(project.fixed.length, 1);
  assert.ok(Math.abs(project.background.mmPerPixel - 10) < 1e-8);
  assert.equal(project.entities[1].positionKeyframes.length, 1);
  assert.equal(await page.locator("#dirty").innerText(), "保存済み");
  await date("2026-10-11");
  assert.equal(await page.locator("#dirty").innerText(), "保存済み");
  assert.equal(await page.locator('#canvas [data-fixed="false"]').count(), 1);
  for (const data of [
    { version: 1 },
    {
      ...project,
      entities: [{ ...project.entities[0], startDate: "2026-02-30" }],
    },
  ]) {
    await page
      .locator("#project-file")
      .setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(data)),
      });
    await page.waitForTimeout(150);
    assert.equal(await page.locator("#tracks tbody tr").count(), 2);
    assert.equal(
      await page.locator("#selected-date").inputValue(),
      "2026-10-11",
    );
  }
  await page
    .locator("#tracks tbody tr")
    .first()
    .locator('[data-date="2026-10-11"]')
    .click();
  await field("name", "未保存変更");
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
  assert.deepEqual(await saveProject(), project);
  await date("2026-10-21");
  const exported = page.waitForEvent("download");
  await page.locator("#export").click();
  const pngDownload = await exported;
  assert.equal(
    pngDownload.suggestedFilename(),
    "spatium-layout-2026-10-21.png",
  );
  const output = await readFile(await pngDownload.path());
  assert.equal(output.subarray(1, 4).toString(), "PNG");
  // Inspect the exported pixels at the machinery location: both movable entities have ended.
  const sample = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = "data:image/png;base64," + data;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(584, 174, 1, 1).data];
  }, output.toString("base64"));
  assert.deepEqual(sample, [255, 255, 255, 255]);
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/layout.png", output);
  await date("2026-10-10");
  await page
    .locator("#tracks tbody tr")
    .first()
    .locator('[data-date="2026-10-10"]')
    .click();
  await page.screenshot({ path: "artifacts/editor.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: date selection, inclusive lifetime, inheritance, keyframe editing, period guards, duplication, fixed objects, drag undo/redo, global deletion, v2 round trip, v1 rejection, unsaved confirmation and dated PNG output; no browser errors.",
  );
} finally {
  await browser.close();
}
