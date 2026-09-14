import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import {
  fresh,
  clone,
  validate,
  calibratedScale,
  createEntity,
  duplicateEntity,
  History,
  bounds,
  snap,
  locked,
  isDate,
  nextDate,
  positionAt,
  setPosition,
  setPeriod,
  removeKeyframe,
  changeDates,
  today,
} from "../dist/model.js";
const fixture = () => {
  const p = fresh();
  p.background = {
    name: "floor.png",
    data: "data:image/png;base64,AAAA",
    width: 1000,
    height: 700,
    mmPerPixel: 10,
    calibrated: true,
  };
  return p;
};
const setup = () => {
  const p = fixture();
  createEntity(p, "2026-10-01");
  return { p, e: p.entities[0] };
};
test("UIDs work without crypto and avoid imported IDs across both collections", () => {
  // Evaluate in an isolated environment without any Web Crypto API.
  const source = readFileSync(new URL("../dist/model.js", import.meta.url), "utf8")
    .replace(/^export /gm, "");
  const model = runInNewContext(`${source}\n({ id, createEntity, duplicateEntity });`, {
    Date: { now: () => 0 },
    Math: { random: () => 0 },
    structuredClone,
  });
  const p = fixture();
  createEntity(p, "2026-10-01", true);
  p.fixed[0].id = "uid-0-1-";
  const created = model.createEntity(p, "2026-10-01");
  assert.notEqual(created, p.fixed[0].id);
  const copied = model.duplicateEntity(p, "2026-10-01", created);
  const fixedCopy = model.duplicateEntity(p, "2026-10-01", p.fixed[0].id, true);
  assert.equal(new Set([created, copied, fixedCopy, p.fixed[0].id]).size, 4);
  const restored = JSON.parse(JSON.stringify(p));
  assert.deepEqual(validate(restored), restored);
  const ids = Array.from({ length: 10000 }, () => model.id());
  assert.equal(new Set(ids).size, ids.length);
});

test("legacy UUIDs survive a round trip alongside new UIDs", () => {
  const { p, e } = setup();
  e.id = "550e8400-e29b-41d4-a716-446655440000";
  duplicateEntity(p, e.startDate, e.id);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(p))), p);
  assert.equal(p.entities[0].id, e.id);
  assert.match(p.entities[1].id, /^uid-/);
});
test("calibration and snapping retain physical dimensions", () => {
  assert.equal(calibratedScale({ x: 0, y: 0 }, { x: 300, y: 400 }, 5000), 10);
  assert.equal(
    calibratedScale({ x: 0, y: 0 }, { x: 3000, y: 4000 }, 10000, 10),
    20,
  );
  assert.throws(() => calibratedScale({ x: 0, y: 0 }, { x: 0, y: 0 }, 10));
  assert.throws(() => calibratedScale({ x: 0, y: 0 }, { x: 1, y: 1 }, -1));
  assert.equal(snap(249, 100), 200);
  assert.equal(snap(-251, 100), -300);
});
test("civil date validation rejects normalization, timestamps, and invalid leap dates", () => {
  for (const d of [
    "0001-01-01",
    "0099-02-28",
    "2000-02-29",
    "2024-02-29",
    "9999-12-31",
    today(),
  ])
    assert.equal(isDate(d), true, d);
  for (const d of [
    "0000-01-01",
    "2026-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-00-01",
    "2026-13-01",
    "2026-01-00",
    "2026-1-01",
    "2026-01-01T00:00:00Z",
    "10000-01-01",
    null,
    0,
  ])
    assert.equal(isDate(d), false, String(d));
});
test("next civil date crosses months, years and leap days without timezone arithmetic", () => {
  for (const [a, b] of [
    ["2026-01-31", "2026-02-01"],
    ["2026-12-31", "2027-01-01"],
    ["2024-02-28", "2024-02-29"],
    ["2024-02-29", "2024-03-01"],
    ["1900-02-28", "1900-03-01"],
    ["0099-12-31", "0100-01-01"],
    ["9999-12-31", null],
  ])
    assert.equal(nextDate(a), b);
  assert.throws(() => nextDate("2026-02-30"));
});
test("existence includes both endpoints and allows an open end", () => {
  const { e } = setup();
  setPeriod(e, e.startDate, "2026-10-20");
  assert.equal(positionAt(e, "2026-09-30"), null);
  assert.deepEqual(positionAt(e, "2026-10-01"), { x: 0, y: 0 });
  assert.deepEqual(positionAt(e, "2026-10-20"), { x: 0, y: 0 });
  assert.equal(positionAt(e, "2026-10-21"), null);
  setPeriod(e, e.startDate, null);
  assert.deepEqual(positionAt(e, "9999-12-31"), { x: 0, y: 0 });
  setPeriod(e, e.startDate, e.startDate);
  assert.deepEqual(positionAt(e, e.startDate), { x: 0, y: 0 });
  assert.equal(positionAt(e, "2026-10-02"), null);
});
test("position edits inherit until the next keyframe, upsert same day and skip no-op edits", () => {
  const { p, e } = setup();
  setPosition(e, "2026-10-08", { x: 3000, y: 0 });
  setPosition(e, "2026-10-15", { x: 5000, y: 0 });
  setPosition(e, "2026-10-10", { x: 3500, y: 0 });
  assert.deepEqual(positionAt(e, "2026-10-07"), { x: 0, y: 0 });
  assert.deepEqual(positionAt(e, "2026-10-09"), { x: 3000, y: 0 });
  assert.deepEqual(positionAt(e, "2026-10-14"), { x: 3500, y: 0 });
  assert.deepEqual(positionAt(e, "2026-10-15"), { x: 5000, y: 0 });
  setPosition(e, "2026-10-10", { x: 3600, y: 100 });
  assert.equal(e.positionKeyframes.length, 4);
  setPosition(e, "2026-10-11", { x: 3600, y: 100 });
  assert.equal(e.positionKeyframes.length, 4);
  const pos = positionAt(e, "2026-10-11");
  pos.x = 999;
  assert.equal(positionAt(e, "2026-10-11").x, 3600);
  assert.throws(() => setPosition(e, "2026-09-30", { x: 100, y: 0 }));
  assert.doesNotThrow(() => validate(p));
});
test("period changes preserve initial position and reject conflicts without mutation", () => {
  const { e } = setup();
  setPosition(e, "2026-10-01", { x: 1000, y: 2000 });
  setPosition(e, "2026-10-08", { x: 3000, y: 0 });
  setPeriod(e, "2026-10-03", "2026-10-20");
  assert.deepEqual(e.positionKeyframes[0], {
    date: "2026-10-03",
    x: 1000,
    y: 2000,
  });
  for (const [start, end] of [
    ["2026-10-08", null],
    ["2026-10-09", null],
    ["2026-10-03", "2026-10-07"],
    ["2026-10-03", "2026-10-02"],
    ["2026-02-30", null],
  ]) {
    const before = clone(e);
    assert.throws(() => setPeriod(e, start, end));
    assert.deepEqual(e, before);
  }
  setPeriod(e, "2026-09-30", null);
  assert.deepEqual(positionAt(e, "2026-10-01"), { x: 1000, y: 2000 });
});
test("keyframe deletion restores previous position and protects initial position", () => {
  const { e } = setup();
  setPosition(e, "2026-10-08", { x: 2000, y: 100 });
  removeKeyframe(e, "2026-10-08");
  assert.deepEqual(positionAt(e, "2026-10-10"), { x: 0, y: 0 });
  assert.throws(() => removeKeyframe(e, e.startDate));
});
test("duplication creates a new lifetime at the evaluated position without copying history", () => {
  const { p, e } = setup();
  setPosition(e, "2026-10-08", { x: 2000, y: 100 });
  setPeriod(e, e.startDate, "2026-10-20");
  const id = duplicateEntity(p, "2026-10-10", e.id),
    copy = p.entities.find((e) => e.id === id);
  assert.notEqual(id, e.id);
  assert.equal(copy.startDate, "2026-10-10");
  assert.equal(copy.endDate, null);
  assert.deepEqual(copy.positionKeyframes, [
    { date: "2026-10-10", x: 2000, y: 100 },
  ]);
  assert.throws(() => duplicateEntity(p, "2026-10-21", e.id));
  assert.equal(p.entities.length, 2);
  copy.width = 1000;
  assert.notEqual(e.width, copy.width);
});
test("timeline dates are sorted, deduplicated, and include first absent days", () => {
  const { p, e } = setup();
  setPosition(e, "2026-10-08", { x: 1000, y: 0 });
  setPeriod(e, e.startDate, "2026-10-20");
  createEntity(p, "2026-10-08");
  assert.deepEqual(changeDates(p), [
    "2026-10-01",
    "2026-10-08",
    "2026-10-20",
    "2026-10-21",
  ]);
  setPeriod(p.entities[1], "2026-10-08", "9999-12-31");
  assert.deepEqual(changeDates(p), [
    "2026-10-01",
    "2026-10-08",
    "2026-10-20",
    "2026-10-21",
    "9999-12-31",
  ]);
  assert.deepEqual(changeDates(fresh()), []);
});
test("bounds use the same dated positions and always include fixed objects", () => {
  const { p, e } = setup();
  const fixed = createEntity(p, "2026-10-01", true);
  p.fixed[0].x = -1000;
  p.fixed[0].y = 9000;
  setPosition(e, "2026-10-08", { x: 20000, y: 0 });
  assert.equal(bounds(p, "2026-10-01").maxX, 10000);
  assert.equal(bounds(p, "2026-10-08").maxX, 20500);
  setPeriod(e, e.startDate, "2026-10-20");
  assert.equal(bounds(p, "2026-10-21").maxX, 10000);
  assert.equal(bounds(p, "2026-09-01").minX, -1000);
  assert.equal(bounds(p, "2026-09-01").maxY, 9300);
  assert.equal(p.fixed[0].id, fixed);
  assert.equal(locked(p), true);
});
test("v2 round trip validates dates, frames, IDs and old format rejection", () => {
  const { p, e } = setup();
  createEntity(p, "2026-10-01", true);
  setPosition(e, "2026-10-08", { x: 1000, y: 0 });
  assert.deepEqual(validate(JSON.parse(JSON.stringify(p))), p);
  assert.throws(() => validate({ version: 1 }), /version 1/);
  for (const mutate of [
    (p) => (p.version = 3),
    (p) => (p.grid.size = 0),
    (p) => (p.entities[0].width = 101),
    (p) => (p.entities[0].width = -100),
    (p) => (p.entities[0].endDate = "2026-09-30"),
    (p) => (p.entities[0].endDate = "2026-10-02"),
    (p) => (p.entities[0].startDate = "2026-02-30"),
    (p) => (p.entities[0].positionKeyframes = []),
    (p) => (p.entities[0].positionKeyframes[0].date = "2026-10-02"),
    (p) => (p.entities[0].positionKeyframes[1].date = "2026-10-01"),
    (p) => (p.entities[0].positionKeyframes[0].x = NaN),
    (p) => p.entities[0].positionKeyframes.reverse(),
    (p) => (p.background.data = "https://example.com/p.png"),
    (p) => (p.fixed[0].id = p.entities[0].id),
    (p) => (p.background.calibrated = false),
  ]) {
    const bad = clone(p);
    mutate(bad);
    assert.throws(() => validate(bad));
  }
  assert.doesNotThrow(() => validate(fresh()));
});
test("history restores keyframes, periods and global removal; invalid commits remain atomic", () => {
  const { p, e } = setup();
  const h = new History(p);
  let next = clone(h.current);
  setPosition(next.entities[0], "2026-10-08", { x: 1500, y: -200 });
  h.commit(next);
  assert.equal(h.past.length, 1);
  h.undo();
  assert.deepEqual(h.current, p);
  assert.equal(h.dirty, false);
  h.redo();
  assert.equal(positionAt(h.current.entities[0], "2026-10-09").x, 1500);
  next = clone(h.current);
  setPeriod(next.entities[0], e.startDate, "2026-10-20");
  h.commit(next);
  h.markSaved();
  next = clone(h.current);
  next.entities = [];
  h.commit(next);
  h.undo();
  assert.equal(h.current.entities.length, 1);
  assert.equal(h.dirty, false);
  const bad = clone(h.current);
  bad.entities[0].positionKeyframes = [];
  assert.throws(() => h.commit(bad));
  assert.equal(h.current.entities.length, 1);
  h.undo();
  assert.equal(h.current.entities[0].endDate, null);
  assert.equal(h.dirty, true);
});

test("end-date columns follow period edits without creating position frames", () => {
  const { p, e } = setup();
  setPeriod(e, e.startDate, "2026-10-20");
  assert.equal(e.positionKeyframes.length, 1);
  setPeriod(e, e.startDate, "2026-10-22");
  assert.deepEqual(changeDates(p), ["2026-10-01", "2026-10-22", "2026-10-23"]);
  setPosition(e, "2026-10-22", { x: 100, y: 0 });
  assert.equal(changeDates(p).filter((d) => d === "2026-10-22").length, 1);
  setPeriod(e, e.startDate, null);
  assert.deepEqual(changeDates(p), ["2026-10-01", "2026-10-22"]);
  setPeriod(e, e.startDate, "2026-10-22");
  removeKeyframe(e, "2026-10-22");
  assert.deepEqual(changeDates(p), ["2026-10-01", "2026-10-22", "2026-10-23"]);
  setPeriod(e, e.startDate, e.startDate);
  assert.deepEqual(changeDates(p), ["2026-10-01", "2026-10-02"]);
});
