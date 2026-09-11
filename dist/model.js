export const id = () => crypto.randomUUID();
export const clone = (value) => structuredClone(value);
export function fresh() {
  return {
    version: 1,
    background: null,
    grid: { size: 100, origin: { x: 0, y: 0 } },
    entities: [],
    fixed: [],
    stages: [{ id: id(), label: "時点 1", positions: {} }],
  };
}
export function locked(p) {
  return p.entities.length > 0 || p.fixed.length > 0;
}
export function snap(value, size) {
  return Math.round(value / size) * size;
}
export function calibratedScale(a, b, distance, currentScale = 1) {
  const length = Math.hypot(a.x - b.x, a.y - b.y);
  if (!Number.isFinite(distance) || distance <= 0 || length < 1e-6)
    throw Error("異なる2点と、正の距離を指定してください。");
  const scale = (currentScale * distance) / length;
  if (!Number.isFinite(scale) || scale <= 0) throw Error("縮尺が不正です。");
  return scale;
}
export function duplicateStage(p, index) {
  const next = clone(p.stages[index]);
  next.id = id();
  next.label += "（コピー）";
  p.stages.splice(index + 1, 0, next);
  return next.id;
}
export function createEntity(p, stageId, isFixed = false) {
  const item = {
    id: id(),
    name: isFixed ? "固定物" : "配置物",
    width: p.grid.size * 5,
    depth: p.grid.size * 3,
    color: isFixed ? "#718493" : "#37a998",
    memo: "",
  };
  if (isFixed) p.fixed.push({ ...item, x: 0, y: 0 });
  else {
    p.entities.push(item);
    p.stages.find((s) => s.id === stageId).positions[item.id] = { x: 0, y: 0 };
  }
  return item.id;
}
export function duplicateEntity(p, stageId, entityId, isFixed = false) {
  const items = isFixed ? p.fixed : p.entities;
  const source = items.find((e) => e.id === entityId);
  const copy = { ...source, id: id(), name: source.name + "（コピー）" };
  items.push(copy);
  if (isFixed) {
    copy.x += p.grid.size;
    copy.y += p.grid.size;
  } else {
    const positions = p.stages.find((s) => s.id === stageId).positions;
    const pos = positions[entityId];
    if (!pos) throw Error("この時点に配置してから複製してください。");
    positions[copy.id] = { x: pos.x + p.grid.size, y: pos.y + p.grid.size };
  }
  return copy.id;
}
export function bounds(p, stageId) {
  const bg = p.background;
  let minX = 0,
    minY = 0,
    maxX = bg ? bg.width * bg.mmPerPixel : 10000,
    maxY = bg ? bg.height * bg.mmPerPixel : 7000;
  const positions = p.stages.find((s) => s.id === stageId)?.positions || {};
  for (const e of [...p.fixed, ...p.entities]) {
    const pos = p.fixed.includes(e) ? e : positions[e.id];
    if (!pos) continue;
    const x = p.grid.origin.x + pos.x,
      y = p.grid.origin.y + pos.y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + e.width);
    maxY = Math.max(maxY, y + e.depth);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
export function validate(value) {
  const fail = () => {
    throw Error("プロジェクトの形式・値・ID参照が不正です。");
  };
  const obj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const num = (x) =>
    typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e9;
  const str = (x, max = 200) => typeof x === "string" && x.length <= max;
  const ids = new Set();
  const identifier = (x) => {
    if (
      !str(x, 100) ||
      !/^[a-zA-Z0-9_-]+$/.test(x) ||
      Object.hasOwn(Object.prototype, x) ||
      ids.has(x)
    )
      fail();
    ids.add(x);
  };
  if (!obj(value) || value.version !== 1)
    throw Error("未対応のファイル形式またはバージョンです。");
  const p = value;
  if (
    !obj(p.grid) ||
    !num(p.grid.size) ||
    p.grid.size <= 0 ||
    !obj(p.grid.origin) ||
    !num(p.grid.origin.x) ||
    !num(p.grid.origin.y)
  )
    fail();
  const multiple = (x) =>
    num(x) && Math.abs(x / p.grid.size - Math.round(x / p.grid.size)) < 1e-7;
  if (p.background !== null) {
    const b = p.background;
    if (
      !obj(b) ||
      !str(b.name, 500) ||
      !str(b.data, 50000000) ||
      !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.data) ||
      !Number.isInteger(b.width) ||
      b.width <= 0 ||
      b.width > 32768 ||
      !Number.isInteger(b.height) ||
      b.height <= 0 ||
      b.height > 32768 ||
      b.width * b.height > 40000000 ||
      !num(b.mmPerPixel) ||
      b.mmPerPixel <= 0 ||
      b.width * b.mmPerPixel > 1e9 ||
      b.height * b.mmPerPixel > 1e9 ||
      typeof b.calibrated !== "boolean"
    )
      fail();
  }
  if (
    !Array.isArray(p.entities) ||
    !Array.isArray(p.fixed) ||
    !Array.isArray(p.stages) ||
    p.stages.length < 1 ||
    p.entities.length + p.fixed.length > 10000 ||
    p.stages.length > 1000
  )
    fail();
  const entity = (e) => {
    if (!obj(e)) fail();
    identifier(e.id);
    if (
      !str(e.name) ||
      !e.name.trim() ||
      !str(e.memo, 10000) ||
      !/^#[0-9a-fA-F]{6}$/.test(e.color) ||
      !multiple(e.width) ||
      e.width <= 0 ||
      !multiple(e.depth) ||
      e.depth <= 0
    )
      fail();
  };
  for (const e of p.entities) entity(e);
  for (const e of p.fixed) {
    entity(e);
    if (!multiple(e.x) || !multiple(e.y)) fail();
  }
  if (locked(p) && !p.background?.calibrated) fail();
  const entityIds = new Set(p.entities.map((e) => e.id));
  for (const s of p.stages) {
    if (!obj(s)) fail();
    identifier(s.id);
    if (!str(s.label) || !s.label.trim() || !obj(s.positions)) fail();
    for (const [key, pos] of Object.entries(s.positions)) {
      if (
        !entityIds.has(key) ||
        !obj(pos) ||
        !multiple(pos.x) ||
        !multiple(pos.y)
      )
        fail();
    }
  }
  return clone(p);
}
export class History {
  constructor(p) {
    this.current = clone(p);
    this.past = [];
    this.future = [];
    this.saved = JSON.stringify(p);
  }
  commit(p) {
    validate(p);
    if (JSON.stringify(p) === JSON.stringify(this.current)) return;
    this.past.push(this.current);
    if (this.past.length > 100) this.past.shift();
    this.current = clone(p);
    this.future = [];
  }
  undo() {
    if (this.past.length) {
      this.future.push(this.current);
      this.current = this.past.pop();
    }
  }
  redo() {
    if (this.future.length) {
      this.past.push(this.current);
      this.current = this.future.pop();
    }
  }
  get dirty() {
    return JSON.stringify(this.current) !== this.saved;
  }
  markSaved() {
    this.saved = JSON.stringify(this.current);
  }
}
