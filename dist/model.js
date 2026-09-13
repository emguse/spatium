export const id = () => crypto.randomUUID();
export const clone = (value) => structuredClone(value);
export function fresh() {
  return {
    version: 2,
    background: null,
    grid: { size: 100, origin: { x: 0, y: 0 } },
    entities: [],
    fixed: [],
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
// Civil dates are compared as canonical strings, without timezone conversion.
export function today() {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function monthDays(y, m) {
  return [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][m - 1];
}
export function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [y, m, d] = value.split("-").map(Number);
  return (
    y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= monthDays(y, m)
  );
}
export function nextDate(value) {
  if (!isDate(value)) throw Error("有効な日付を入力してください。");
  let [y, m, d] = value.split("-").map(Number);
  if (++d > monthDays(y, m)) {
    d = 1;
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  if (y > 9999) return null; // No representable date after the supported maximum.
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function positionAt(entity, date) {
  if (
    date < entity.startDate ||
    (entity.endDate !== null && date > entity.endDate)
  )
    return null;
  const frame = entity.positionKeyframes.findLast((k) => k.date <= date);
  return frame ? { x: frame.x, y: frame.y } : null;
}
export function changeDates(project) {
  const dates = new Set();
  for (const e of project.entities) {
    dates.add(e.startDate);
    for (const k of e.positionKeyframes) dates.add(k.date);
    if (e.endDate !== null) {
      dates.add(e.endDate);
      const after = nextDate(e.endDate);
      if (after) dates.add(after);
    }
  }
  return [...dates].sort();
}
export function setPosition(entity, date, pos) {
  const current = positionAt(entity, date);
  if (!isDate(date) || !current)
    throw Error("存在期間内の日付を選択してください。");
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y))
    throw Error("位置が不正です。");
  if (current.x === pos.x && current.y === pos.y) return;
  const frame = entity.positionKeyframes.find((k) => k.date === date);
  if (frame) Object.assign(frame, pos);
  else entity.positionKeyframes.push({ date, x: pos.x, y: pos.y });
  entity.positionKeyframes.sort((a, b) => a.date.localeCompare(b.date));
}
export function setPeriod(entity, startDate, endDate) {
  if (!isDate(startDate) || (endDate !== null && !isDate(endDate)))
    throw Error("有効な開始日・終了日を入力してください。");
  if (endDate !== null && endDate < startDate)
    throw Error("終了日は開始日以降にしてください。");
  const later = entity.positionKeyframes.slice(1);
  if (later.some((k) => k.date <= startDate))
    throw Error("開始日は後続の位置キーフレームより前にしてください。");
  if (endDate !== null && later.some((k) => k.date > endDate))
    throw Error(
      "終了日より後に位置キーフレームがあります。先に該当する位置変更を削除してください。",
    );
  entity.positionKeyframes[0].date = startDate;
  entity.startDate = startDate;
  entity.endDate = endDate;
}
export function removeKeyframe(entity, date) {
  if (date === entity.startDate)
    throw Error("開始日の初期位置は削除できません。");
  entity.positionKeyframes = entity.positionKeyframes.filter(
    (k) => k.date !== date,
  );
}
export function createEntity(p, date, isFixed = false) {
  if (!isDate(date)) throw Error("有効な日付を選択してください。");
  const item = {
    id: id(),
    name: isFixed ? "固定物" : "配置物",
    width: p.grid.size * 5,
    depth: p.grid.size * 3,
    color: isFixed ? "#718493" : "#37a998",
    memo: "",
  };
  if (isFixed) p.fixed.push({ ...item, x: 0, y: 0 });
  else
    p.entities.push({
      ...item,
      startDate: date,
      endDate: null,
      positionKeyframes: [{ date, x: 0, y: 0 }],
    });
  return item.id;
}
export function duplicateEntity(p, date, entityId, isFixed = false) {
  const items = isFixed ? p.fixed : p.entities;
  const source = items.find((e) => e.id === entityId);
  if (!source) throw Error("配置物が見つかりません。");
  const pos = isFixed ? source : positionAt(source, date);
  if (!isDate(date) || !pos)
    throw Error("存在期間内の日付で複製してください。");
  const copy = { ...clone(source), id: id(), name: source.name + "（コピー）" };
  if (!isFixed) {
    copy.startDate = date;
    copy.endDate = null;
    copy.positionKeyframes = [{ date, ...pos }];
  }
  items.push(copy);
  return copy.id;
}
export function bounds(p, date) {
  const bg = p.background;
  let minX = 0,
    minY = 0,
    maxX = bg ? bg.width * bg.mmPerPixel : 10000,
    maxY = bg ? bg.height * bg.mmPerPixel : 7000;
  for (const e of [...p.fixed, ...p.entities]) {
    const pos = p.fixed.includes(e) ? e : positionAt(e, date);
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
  if (obj(value) && value.version === 1)
    throw Error(
      "version 1のプロジェクトは読み込めません。日付付きのversion 2形式を使用してください。旧形式の自動移行には対応していません。",
    );
  if (!obj(value) || value.version !== 2)
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
    p.entities.length + p.fixed.length > 10000
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
  for (const e of p.entities) {
    entity(e);
    if (
      !isDate(e.startDate) ||
      (e.endDate !== null && (!isDate(e.endDate) || e.endDate < e.startDate)) ||
      !Array.isArray(e.positionKeyframes) ||
      !e.positionKeyframes.length ||
      e.positionKeyframes.length > 10000
    )
      fail();
    let previous = null;
    for (const k of e.positionKeyframes) {
      if (
        !obj(k) ||
        !isDate(k.date) ||
        !multiple(k.x) ||
        !multiple(k.y) ||
        k.date < e.startDate ||
        (e.endDate !== null && k.date > e.endDate) ||
        (previous !== null && k.date <= previous)
      )
        fail();
      previous = k.date;
    }
    if (e.positionKeyframes[0].date !== e.startDate) fail();
  }
  for (const e of p.fixed) {
    entity(e);
    if (!multiple(e.x) || !multiple(e.y)) fail();
  }
  if (locked(p) && !p.background?.calibrated) fail();
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
