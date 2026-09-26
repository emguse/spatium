import {
  fresh,
  clone,
  locked,
  snap,
  calibratedScale,
  today,
  isDate,
  positionAt,
  changeDates,
  setPosition,
  setPeriod,
  removeKeyframe,
  createEntity,
  duplicateEntity,
  bounds,
  collisionsAt,
  validate,
  History,
} from "./model.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let history = new History(fresh()),
  selectedDate = today(),
  selection = null,
  fixedMode = false,
  mode = null,
  points = [],
  zoom = 0.1,
  view = null,
  drag = null;
const p = () => history.current,
  svg = $("#canvas");
function message(text) {
  $("#status").textContent = text;
}
function report(error) {
  message(error.message || String(error));
  alert(error.message || String(error));
}
function update(fn) {
  const oldSelection = selection,
    oldDate = selectedDate;
  try {
    const next = clone(p());
    fn(next);
    history.commit(next);
    render();
  } catch (e) {
    selection = oldSelection;
    selectedDate = oldDate;
    render();
    report(e);
  }
}
function selected() {
  return selection
    ? (selection.fixed ? p().fixed : p().entities).find(
        (e) => e.id === selection.id,
      )
    : null;
}
function position() {
  const e = selected();
  return !e ? null : selection.fixed ? e : positionAt(e, selectedDate);
}
function editable() {
  return selection && selection.fixed === fixedMode;
}
function cancelMode() {
  mode = null;
  points = [];
}
function render() {
  $("#selected-date").value = selectedDate;
  if (!selected()) selection = null;
  $("#dirty").textContent = history.dirty ? "● 未保存" : "保存済み";
  $("#undo").disabled = !history.past.length;
  $("#redo").disabled = !history.future.length;
  $("#add").disabled = !p().background?.calibrated;
  $("#add").textContent = fixedMode ? "＋ 固定物" : "＋ 配置物";
  $("#fixed").classList.toggle("active", fixedMode);
  $("#fixed").textContent = fixedMode ? "固定物編集中" : "固定物を編集";
  $("#export").disabled = !p().background;
  renderCanvas();
  renderProperties();
  renderTracks();
}
function renderCanvas() {
  const project = p(),
    b = bounds(project, selectedDate),
    collisions = collisionsAt(project, selectedDate),
    partners = new Map(),
    pad = project.grid.size * 2;
  const stamp = $("#collision-stamp");
  stamp.hidden = collisions.length === 0;
  stamp.textContent = collisions.length
    ? `⚠ 干渉発生中 · ${collisions.length}組`
    : "";
  stamp.setAttribute(
    "aria-label",
    collisions.length
      ? `${selectedDate}、干渉発生中、重なり${collisions.length}組`
      : "",
  );
  for (const collision of collisions) {
    partners.set(collision.aId, [...(partners.get(collision.aId) || []), collision.bName]);
    partners.set(collision.bId, [...(partners.get(collision.bId) || []), collision.aName]);
  }
  view = {
    x: b.minX - pad,
    y: b.minY - pad,
    w: b.width + pad * 2,
    h: b.height + pad * 2,
  };
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  svg.setAttribute("width", Math.max(1, view.w * zoom));
  svg.setAttribute("height", Math.max(1, view.h * zoom));
  $("#zoom").textContent =
    `${Math.round(zoom * (project.background?.mmPerPixel || 1) * 100)}%`;
  const g = project.grid;
  let html = "";
  if (project.background) {
    const bg = project.background;
    html += `<image href="${bg.data}" x="0" y="0" width="${bg.width * bg.mmPerPixel}" height="${bg.height * bg.mmPerPixel}"/>`;
  }
  // Coarsen only grid rendering at distant zoom; snapping remains the configured interval.
  const displayGrid = g.size * Math.max(1, Math.ceil(8 / (g.size * zoom)));
  html += `<defs><pattern id="grid" x="${g.origin.x}" y="${g.origin.y}" width="${displayGrid}" height="${displayGrid}" patternUnits="userSpaceOnUse"><path d="M ${displayGrid} 0 H 0 V ${displayGrid}" fill="none" stroke="#597d923d" stroke-width="${1 / zoom}"/></pattern></defs><rect x="${view.x}" y="${view.y}" width="${view.w}" height="${view.h}" fill="url(#grid)"/>`;
  for (const isFixed of [true, false])
    for (const e of isFixed ? project.fixed : project.entities) {
      const pos = isFixed ? e : positionAt(e, selectedDate);
      if (!pos) continue;
      const active = selection?.id === e.id;
      const collidingPartners = partners.get(e.id) || [];
      const colliding = collidingPartners.length > 0;
      const x = g.origin.x + pos.x,
        y = g.origin.y + pos.y;
      const label = colliding
        ? `${e.name}。重なり：${[...new Set(collidingPartners)].join("、")}`
        : e.name;
      html += `<g data-id="${e.id}" data-fixed="${isFixed}" class="entity ${isFixed !== fixedMode ? "locked" : ""}" transform="translate(${x} ${y})" aria-label="${esc(label)}"><title>${esc(label)}</title><rect width="${e.width}" height="${e.depth}" fill="${e.color}" fill-opacity=".8" stroke="${colliding ? "#d0442d" : active ? "#073e64" : isFixed ? "#526675" : "#1b7066"}" stroke-width="${(colliding ? Math.max(active ? 3 : 2, 2) : active ? 3 : 1) / zoom}" ${colliding ? 'stroke-dasharray="' + 7 / zoom + " " + 3 / zoom + '"' : isFixed ? 'stroke-dasharray="' + 4 / zoom + " " + 3 / zoom + '"' : ""}/><text x="${e.width / 2}" y="${e.depth / 2}" text-anchor="middle" dominant-baseline="central" fill="#102f3e" font-size="${Math.min(14 / zoom, e.depth * 0.35, e.width / Math.max(3, e.name.length))}" pointer-events="none">${esc(e.name)}</text></g>`;
    }
  for (const pt of points)
    html += `<circle cx="${pt.x}" cy="${pt.y}" r="${5 / zoom}" fill="#ef6a43"/>`;
  svg.innerHTML = html;
}
function field(label, key, value, type = "text", extra = "") {
  return `<label for="${key}">${label}</label><input id="${key}" type="${type}" value="${esc(value)}" ${extra}>`;
}
function bind(id, fn) {
  const el = $("#" + id);
  if (el) el.onclick = fn;
}
function renderProperties() {
  const e = selected(),
    pos = position();
  if (e) {
    const disabled = editable() ? "" : "disabled";
    const isFixed = selection.fixed;
    const hasFrame =
      !isFixed && e.positionKeyframes.some((k) => k.date === selectedDate);
    const period = isFixed
      ? ""
      : `
      <h3>存在期間</h3>
      ${field("開始日（この日から存在）", "start-date", e.startDate, "date", `${disabled} min="0001-01-01" max="9999-12-31"`)}
      ${field("終了日（この日まで存在）", "end-date", e.endDate ?? "", "date", `${disabled} min="0001-01-01" max="9999-12-31"`)}
      <p class="hint">終了日が空欄なら無期限です。途中の退場・再登場は別の配置物で表します。</p>`;
    $("#properties").innerHTML = `
      <h2>${isFixed ? "固定物" : "配置物"}のプロパティ</h2>
      <span class="badge">${isFixed ? "全期間で共通" : pos ? "選択日に存在" : "選択日は存在期間外"}</span>
      ${period}
      ${field("名称（全期間共通）", "name", e.name, "text", `${disabled} maxlength="200"`)}
      <div class="pair">${field("幅（mm）", "width", e.width, "number", `${disabled} min="${p().grid.size}" step="${p().grid.size}"`)}${field("奥行き（mm）", "depth", e.depth, "number", `${disabled} min="${p().grid.size}" step="${p().grid.size}"`)}</div>
      ${field("色（全期間共通）", "color", e.color, "color", disabled)}
      <label for="memo">メモ（全期間共通）</label><textarea id="memo" maxlength="10000" ${disabled}>${esc(e.memo)}</textarea>
      <h3>${isFixed ? "共通の位置" : selectedDate + " の位置"}</h3>
      <div class="pair">${field("X（mm）", "x", pos?.x ?? "", "number", `${disabled} ${!pos ? "disabled" : ""} step="${p().grid.size}"`)}${field("Y（mm）", "y", pos?.y ?? "", "number", `${disabled} ${!pos ? "disabled" : ""} step="${p().grid.size}"`)}</div>
      ${!isFixed ? `<p class="hint">${!pos ? "位置を編集するには、存在期間内の日付を選択するか、存在期間を変更してください。" : hasFrame ? "この日に位置キーフレームがあります。変更は次の位置変更日まで反映されます。" : "直前の位置を引き継いでいます。移動すると、この日にキーフレームを作成します。"}</p>` : ""}
      <div class="actions"><button id="copy" ${disabled} ${!pos ? "disabled" : ""}>複製</button>
      ${!isFixed ? `<button id="end-here" ${disabled} ${!pos ? "disabled" : ""}>この日まで存在</button><button id="remove-keyframe" ${disabled} ${!hasFrame || selectedDate === e.startDate ? "disabled" : ""}>選択日の位置変更を削除</button>` : ""}
      <button id="remove" class="danger" ${disabled}>${isFixed ? "固定物を削除" : "配置物を全期間から削除"}</button>
      <button id="deselect">図面の設定</button></div>
      <p class="hint">${!editable() ? "編集モードを切り替えると変更できます。" : "属性の変更は全期間に反映されます。位置はグリッド原点からの距離です。"}</p>`;
    for (const key of [
      "name",
      "width",
      "depth",
      "color",
      "memo",
      "x",
      "y",
      "start-date",
      "end-date",
    ]) {
      const input = $("#" + key);
      if (!input) continue;
      input.onchange = () =>
        update((next) => {
          const item = (isFixed ? next.fixed : next.entities).find(
            (v) => v.id === e.id,
          );
          if (key === "start-date" || key === "end-date") {
            setPeriod(
              item,
              key === "start-date" ? input.value : item.startDate,
              key === "end-date" ? input.value || null : item.endDate,
            );
          } else if (["x", "y"].includes(key)) {
            const n = Number(input.value);
            if (!input.value.trim() || !Number.isFinite(n))
              throw Error("数値を入力してください。");
            if (isFixed) item[key] = snap(n, next.grid.size);
            else
              setPosition(item, selectedDate, {
                ...positionAt(item, selectedDate),
                [key]: snap(n, next.grid.size),
              });
          } else if (["width", "depth"].includes(key)) {
            const n = Number(input.value);
            if (!Number.isFinite(n) || n <= 0)
              throw Error("寸法は正の値を入力してください。");
            item[key] = Math.max(next.grid.size, snap(n, next.grid.size));
          } else {
            item[key] = input.value;
            if (key === "name" && !item[key].trim())
              throw Error("名称を入力してください。");
          }
        });
    }
    bind("copy", () =>
      update((next) => {
        selection = {
          id: duplicateEntity(next, selectedDate, e.id, isFixed),
          fixed: isFixed,
        };
      }),
    );
    bind("remove", removeSelected);
    bind("end-here", () =>
      update((next) => {
        const item = next.entities.find((v) => v.id === e.id);
        setPeriod(item, item.startDate, selectedDate);
      }),
    );
    bind("remove-keyframe", () =>
      update((next) =>
        removeKeyframe(
          next.entities.find((v) => v.id === e.id),
          selectedDate,
        ),
      ),
    );
    bind("deselect", () => {
      selection = null;
      cancelMode();
      render();
    });
    return;
  }
  const isLocked = locked(p()),
    bg = p().background;
  $("#properties").innerHTML =
    `<h2>図面の設定</h2><button id="load-image" ${isLocked ? "disabled" : ""}>${bg ? "背景画像を変更" : "背景画像を読み込む"}</button><p class="hint">PNG・JPEG / 画像は端末内で処理</p>${bg ? `<p>${esc(bg.name)}<br><span class="hint">${bg.width} × ${bg.height} px</span></p><span class="badge">${bg.calibrated ? "校正済み" : "縮尺の設定が必要"}</span><div class="actions"><button id="calibrate" ${isLocked ? "disabled" : ""}>2点で縮尺を設定</button></div><p class="hint">既知の距離の両端をクリックします。</p>` : "<p>まず背景図面を読み込み、実寸法に合わせてください。</p>"}<h3>グリッド</h3>${field("間隔（mm）", "grid-size", p().grid.size, "number", `min="0.001" step="any" ${isLocked ? "disabled" : ""}`)}<div class="actions"><button id="origin" ${isLocked || !bg?.calibrated ? "disabled" : ""}>原点を図面上で指定</button></div><p class="hint">原点：${p().grid.origin.x.toFixed(1)}, ${p().grid.origin.y.toFixed(1)} mm<br>${isLocked ? "配置物があるため、背景・縮尺・グリッドは固定されています。" : "配置を始める前に設定してください。"}</p><h3>操作</h3><p class="hint">ドラッグで移動 / Deleteで全期間から削除<br>Ctrl・⌘ + Zで元に戻す<br>Ctrl・⌘ + Sで保存<br>Escで操作をキャンセル</p>`;
  bind("load-image", () => $("#image-file").click());
  bind("calibrate", () => {
    mode = "calibrate";
    points = [];
    message("既知の距離の1点目をクリックしてください。");
    renderCanvas();
  });
  bind("origin", () => {
    mode = "origin";
    message("グリッド原点をクリックしてください。");
  });
  $("#grid-size").onchange = () =>
    update((next) => {
      const n = Number($("#grid-size").value);
      if (!Number.isFinite(n) || n <= 0)
        throw Error("グリッド間隔は正の値を入力してください。");
      next.grid.size = n;
    });
}
function selectDate(date) {
  if (!isDate(date)) {
    $("#selected-date").value = selectedDate;
    report(Error("有効な日付を選択してください。"));
    return;
  }
  drag = null;
  cancelMode();
  selectedDate = date;
  render();
  message(`${date} の配置を表示しています。`);
}
$("#selected-date").onchange = (event) => selectDate(event.target.value);
function renderTracks() {
  const project = p(),
    changes = changeDates(project),
    collisionCount = collisionsAt(project, selectedDate).length,
    dates = [...new Set([...changes, selectedDate])].sort();
  $("#tracks").innerHTML =
    `<table><thead><tr><th>配置物 / ${project.entities.length}</th>${dates.map((date) => { const activeCollision = date === selectedDate && collisionCount > 0; return `<th class="${date === selectedDate ? "selected" : ""}${activeCollision ? " collision-day" : ""}"><button data-date="${date}" aria-label="${date}${date === selectedDate ? "、選択日" : ""}${activeCollision ? `、干渉発生中、${collisionCount}組` : ""}">${date}${!changes.includes(date) ? '<span class="date-note">選択日</span>' : ""}${activeCollision ? '<span class="timeline-warning" aria-hidden="true">⚠</span>' : ""}</button></th>`; }).join("")}</tr></thead><tbody>${project.entities
      .map(
        (e) =>
          `<tr><td>${esc(e.name)}</td>${dates
            .map((date) => {
              const exists = !!positionAt(e, date),
                keyframe = e.positionKeyframes.some((k) => k.date === date),
                ending = e.endDate === date;
              return `<td class="${date === selectedDate ? "selected" : ""}"><button data-date="${date}" data-entity="${e.id}" data-keyframe="${keyframe}" data-ending="${ending}" class="life-cell ${exists ? "present" : ""}" aria-label="${esc(e.name)}、${date}、${exists ? (keyframe ? "位置キーフレーム" : "存在・位置を継承") : "不在"}${ending ? "、終了日" : ""}" aria-pressed="${selection?.id === e.id && date === selectedDate}">${exists ? '<span class="life-band" aria-hidden="true"></span>' : ""}<span class="frame-marker">${keyframe ? "◆" : exists ? "" : "—"}${ending ? '<span class="end-marker">終</span>' : ""}</span></button></td>`;
            })
            .join("")}</tr>`,
      )
      .join(
        "",
      )}</tbody></table>${!project.entities.length ? '<div class="empty">日付を選んで配置物を作成すると、存在期間と位置変更が表示されます。</div>' : ""}`;
  $("#tracks")
    .querySelectorAll("[data-date]")
    .forEach(
      (btn) =>
        (btn.onclick = () => {
          if (btn.dataset.entity) {
            fixedMode = false;
            selection = { id: btn.dataset.entity, fixed: false };
          }
          selectDate(btn.dataset.date);
        }),
    );
}
function world(event) {
  const pt = new DOMPoint(event.clientX, event.clientY);
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
svg.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const pt = world(event);
  if (mode) {
    if (mode === "calibrate") {
      points.push({ x: pt.x, y: pt.y });
      renderCanvas();
      if (points.length === 1) {
        message("2点目をクリックしてください。");
        return;
      }
      const raw = prompt("2点間の実際の距離（mm）");
      if (raw !== null)
        update((next) => {
          next.background.mmPerPixel = calibratedScale(
            points[0],
            points[1],
            Number(raw),
            next.background.mmPerPixel,
          );
          next.background.calibrated = true;
          next.grid.origin = { x: 0, y: 0 };
        });
      cancelMode();
      fit();
      message("縮尺設定を終了しました。");
    } else if (mode === "origin") {
      update((next) => {
        next.grid.origin = { x: pt.x, y: pt.y };
      });
      cancelMode();
      message("グリッド原点を設定しました。");
    }
    return;
  }
  const target = event.target.closest("[data-id]");
  if (!target) {
    selection = null;
    renderProperties();
    renderCanvas();
    return;
  }
  selection = { id: target.dataset.id, fixed: target.dataset.fixed === "true" };
  renderProperties();
  if (!editable()) {
    renderCanvas();
    return;
  }
  const pos = position();
  drag = {
    pointer: event.pointerId,
    start: pt,
    pos: { x: pos.x, y: pos.y },
    next: { x: pos.x, y: pos.y },
    target,
  };
  svg.setPointerCapture(event.pointerId);
});
svg.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const pt = world(event);
  drag.next = {
    x: snap(drag.pos.x + pt.x - drag.start.x, p().grid.size),
    y: snap(drag.pos.y + pt.y - drag.start.y, p().grid.size),
  };
  drag.target.setAttribute(
    "transform",
    `translate(${p().grid.origin.x + drag.next.x} ${p().grid.origin.y + drag.next.y})`,
  );
});
svg.addEventListener("pointerup", () => {
  if (!drag) return;
  const nextPos = drag.next;
  drag = null;
  update((next) => {
    if (selection.fixed)
      Object.assign(
        next.fixed.find((e) => e.id === selection.id),
        nextPos,
      );
    else
      setPosition(
        next.entities.find((e) => e.id === selection.id),
        selectedDate,
        nextPos,
      );
  });
});
svg.addEventListener("pointercancel", () => {
  drag = null;
  renderCanvas();
});
function removeSelected() {
  if (!selected() || !editable()) return;
  if (!confirm(`「${selected().name}」を全期間から削除しますか？`)) return;
  cancelMode();
  update((next) => {
    if (selection.fixed)
      next.fixed = next.fixed.filter((e) => e.id !== selection.id);
    else next.entities = next.entities.filter((e) => e.id !== selection.id);
  });
}
function fit() {
  const b = bounds(p(), selectedDate),
    box = $("#viewport");
  zoom = Math.min(
    (box.clientWidth - 32) / (b.width + p().grid.size * 4),
    (box.clientHeight - 32) / (b.height + p().grid.size * 4),
  );
  zoom = Math.max(0.000001, zoom);
  renderCanvas();
  box.scrollTo(0, 0);
}
function changeZoom(factor) {
  zoom = Math.max(0.000001, Math.min(10, zoom * factor));
  renderCanvas();
}
bind("fit", fit);
bind("in", () => changeZoom(1.25));
bind("out", () => changeZoom(0.8));
bind("fixed", () => {
  fixedMode = !fixedMode;
  selection = null;
  cancelMode();
  render();
  message(
    fixedMode
      ? "固定物の変更は全期間に反映されます。"
      : "配置物を移動すると、選択日から次の位置変更日まで反映されます。",
  );
});
bind("add", () => {
  cancelMode();
  update((next) => {
    selection = {
      id: createEntity(next, selectedDate, fixedMode),
      fixed: fixedMode,
    };
  });
  message("配置物を作成しました。ドラッグまたは数値入力で位置を調整できます。");
});
bind("undo", () => {
  cancelMode();
  drag = null;
  history.undo();
  render();
});
bind("redo", () => {
  cancelMode();
  drag = null;
  history.redo();
  render();
});
function canReplace() {
  return (
    !history.dirty || confirm("未保存の変更があります。破棄して続けますか？")
  );
}
function replace(project) {
  history = new History(project);
  selectedDate = changeDates(project)[0] || today();
  selection = null;
  fixedMode = false;
  cancelMode();
  render();
  fit();
}
bind("new", () => {
  if (canReplace()) {
    replace(fresh());
    message("新しいプロジェクトを作成しました。");
  }
});
bind("open", () => $("#project-file").click());
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function save() {
  download(
    new Blob([JSON.stringify(p(), null, 2)], { type: "application/json" }),
    "spatium.json",
  );
  history.markSaved();
  render();
  message("プロジェクトファイルをダウンロードしました。");
}
bind("save", save);
function decodeImage(data) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Error("画像を読み込めませんでした。"));
    img.src = data;
  });
}
function dataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("ファイルを読み込めませんでした。"));
    reader.readAsDataURL(file);
  });
}
$("#image-file").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || locked(p())) return;
  const previous = p();
  try {
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 30000000
    )
      throw Error("30MB以下のPNG・JPEG画像を選んでください。");
    const data = await dataURL(file),
      img = await decodeImage(data);
    if (p() !== previous)
      throw Error("作業内容が変わりました。画像を選び直してください。");
    const next = clone(p());
    next.background = {
      name: file.name,
      data,
      width: img.naturalWidth,
      height: img.naturalHeight,
      mmPerPixel: 1,
      calibrated: false,
    };
    next.grid.origin = { x: 0, y: 0 };
    history.commit(next);
    selection = null;
    cancelMode();
    render();
    fit();
    message("「2点で縮尺を設定」で実寸法に合わせてください。");
  } catch (e) {
    report(e);
  }
};
$("#project-file").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 60000000)
      throw Error("プロジェクトファイルは60MB以下にしてください。");
    const project = validate(JSON.parse(await file.text()));
    const img = project.background
      ? await decodeImage(project.background.data)
      : null;
    if (
      img &&
      (img.naturalWidth !== project.background.width ||
        img.naturalHeight !== project.background.height)
    )
      throw Error("背景画像の寸法が保存データと一致しません。");
    if (canReplace()) {
      replace(project, img);
      message("プロジェクトを読み込みました。");
    }
  } catch (e) {
    report(e);
  }
};
bind("export", async () => {
  const snapshot = clone(p()),
    current = selectedDate;
  try {
    const b = bounds(snapshot, current),
      padding = 24,
      titleHeight = 36;
    const scale = Math.min(
      1 / snapshot.background.mmPerPixel,
      4096 / (b.width + 1),
      4096 / (b.height + 1),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(b.width * scale) + padding * 2;
    canvas.height = Math.ceil(b.height * scale) + padding * 2 + titleHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("画像出力を初期化できません。");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#193446";
    ctx.font = "16px sans-serif";
    ctx.fillText(current, padding, 26, canvas.width - padding * 2);
    ctx.translate(
      padding - b.minX * scale,
      padding + titleHeight - b.minY * scale,
    );
    const bg = snapshot.background;
    const img = await decodeImage(bg.data);
    ctx.drawImage(
      img,
      0,
      0,
      bg.width * bg.mmPerPixel * scale,
      bg.height * bg.mmPerPixel * scale,
    );
    for (const isFixed of [true, false])
      for (const e of isFixed ? snapshot.fixed : snapshot.entities) {
        const pos = isFixed ? e : positionAt(e, current);
        if (!pos) continue;
        const x = (snapshot.grid.origin.x + pos.x) * scale,
          y = (snapshot.grid.origin.y + pos.y) * scale,
          w = e.width * scale,
          h = e.depth * scale;
        ctx.fillStyle = e.color;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#294d5c";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.fillStyle = "#102f3e";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${Math.max(1, Math.min(14, h * 0.35))}px sans-serif`;
        ctx.fillText(e.name, x + w / 2, y + h / 2, Math.max(1, w - 4));
        ctx.restore();
      }
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw Error("PNGを生成できませんでした。");
    download(blob, `spatium-layout-${current}.png`);
    message("選択中の日付の配置をPNGで出力しました。");
  } catch (e) {
    report(e);
  }
});
window.addEventListener("beforeunload", (event) => {
  if (history.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    drag = null;
    cancelMode();
    renderCanvas();
    message("操作をキャンセルしました。");
    return;
  }
  const input = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
    return;
  }
  if (input) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    (event.shiftKey ? $("#redo") : $("#undo")).click();
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removeSelected();
  }
});
render();
fit();
if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(
      document.modelContext.registerTool({
        name: "read_spatium_layout",
        description:
          "Read the selected date, existence periods, and evaluated layout positions.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute(input) {
          if (!input || typeof input !== "object" || Object.keys(input).length)
            throw Error("Expected empty object");
          return {
            date: selectedDate,
            entities: p().entities.map((e) => ({
              id: e.id,
              name: e.name,
              startDate: e.startDate,
              endDate: e.endDate,
              position: positionAt(e, selectedDate) || null,
            })),
            fixedCount: p().fixed.length,
          };
        },
      }),
    ).catch(() => {});
  } catch {
    /* Optional browser API. */
  }
}
