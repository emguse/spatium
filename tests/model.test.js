import test from "node:test";
import assert from "node:assert/strict";
import {
  fresh,
  clone,
  validate,
  calibratedScale,
  createEntity,
  duplicateEntity,
  duplicateStage,
  History,
  bounds,
  snap,
  locked,
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
test("calibration expresses a known 2-point distance in mm independent of display zoom", () => {
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
test("3-stage lifecycle, shared attributes, duplication, removal and reappearance", () => {
  const p = fixture(),
    s1 = p.stages[0].id,
    e = createEntity(p, s1);
  p.stages[0].positions[e] = { x: 100, y: 200 };
  const s2 = duplicateStage(p, 0);
  p.stages[1].positions[e].x = 800;
  assert.equal(p.stages[0].positions[e].x, 100);
  p.entities[0].name = "加工機";
  p.entities[0].width = 1000;
  const s3 = duplicateStage(p, 1);
  delete p.stages[2].positions[e];
  assert.equal(p.entities.length, 1);
  assert.equal(p.stages[2].positions[e], undefined);
  p.stages[2].positions[e] = { x: 0, y: 100 };
  const copy = duplicateEntity(p, s3, e);
  assert.notEqual(copy, e);
  assert.equal(p.stages[0].positions[copy], undefined);
  assert.equal(p.stages[1].positions[copy], undefined);
  assert.equal(p.stages[2].positions[copy].x, 100);
  assert.equal(p.entities.find((x) => x.id === e).name, "加工機");
  assert.equal(validate(p).stages.length, 3);
  assert.notEqual(s2, s3);
});
test("fixed objects are shared and included in bounds outside the background", () => {
  const p = fixture(),
    id = createEntity(p, p.stages[0].id, true);
  p.fixed[0].x = -1000;
  p.fixed[0].y = 9000;
  duplicateStage(p, 0);
  assert.equal(p.stages[0].positions[id], undefined);
  assert.deepEqual(bounds(p, p.stages[0].id), bounds(p, p.stages[1].id));
  assert.equal(bounds(p, p.stages[0].id).minX, -1000);
  assert.equal(bounds(p, p.stages[0].id).maxY, 9300);
  assert.equal(locked(p), true);
});
test("JSON round trip preserves complete project; unknown versions and references are rejected", () => {
  const p = fixture();
  createEntity(p, p.stages[0].id);
  createEntity(p, p.stages[0].id, true);
  duplicateStage(p, 0);
  assert.deepEqual(validate(JSON.parse(JSON.stringify(p))), p);
  for (const mutate of [
    (p) => (p.version = 2),
    (p) => (p.stages = []),
    (p) => (p.grid.size = 0),
    (p) => (p.entities[0].width = 101),
    (p) => (p.entities[0].width = -100),
    (p) => (p.stages[0].positions.unknown = { x: 0, y: 0 }),
    (p) => (p.stages[0].positions[p.entities[0].id].x = NaN),
    (p) => (p.background.data = "https://example.com/p.png"),
    (p) => (p.fixed[0].id = p.entities[0].id),
    (p) => (p.background.calibrated = false),
  ]) {
    const invalid = clone(p);
    mutate(invalid);
    assert.throws(() => validate(invalid));
  }
  assert.doesNotThrow(() => validate(fresh()));
});
test("history treats drag as a single transaction and does not change saved checkpoint", () => {
  const p = fixture(),
    e = createEntity(p, p.stages[0].id);
  const h = new History(p),
    next = clone(p);
  next.stages[0].positions[e] = { x: 1500, y: -200 };
  h.commit(next);
  assert.equal(h.dirty, true);
  assert.equal(h.past.length, 1);
  h.undo();
  assert.deepEqual(h.current, p);
  assert.equal(h.dirty, false);
  h.redo();
  assert.deepEqual(h.current, next);
  h.markSaved();
  assert.equal(h.dirty, false);
  const bad = clone(next);
  bad.grid.size = -1;
  assert.throws(() => h.commit(bad));
  assert.deepEqual(h.current, next);
  h.undo();
  assert.equal(h.dirty, true);
  const branch = clone(h.current);
  branch.entities[0].name = "改訂";
  h.commit(branch);
  assert.equal(h.future.length, 0);
});
