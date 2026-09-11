import {
  fresh,
  clone,
  locked,
  snap,
  calibratedScale,
  duplicateStage,
  createEntity,
  duplicateEntity,
  bounds,
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
  stageId = history.current.stages[0].id,
  selection = null,
  fixedMode = false,
  mode = null,
  points = [],
  zoom = 0.1,
  view = null,
  drag = null;
const p = () => history.current,
  stage = () => p().stages.find((s) => s.id === stageId),
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
    oldStageId = stageId;
  try {
    const next = clone(p());
    fn(next);
    history.commit(next);
    render();
  } catch (e) {
    selection = oldSelection;
    stageId = oldStageId;
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
  return !e ? null : selection.fixed ? e : stage().positions[e.id];
}
function editable() {
  return selection && selection.fixed === fixedMode;
}
function cancelMode() {
  mode = null;
  points = [];
}
function render() {
  if (!p().stages.some((s) => s.id === stageId)) stageId = p().stages[0].id;
  if (!selected()) selection = null;
  $("#dirty").textContent = history.dirty ? "● 未保存" : "保存済み";
  $("#undo").disabled = !history.past.length;
  $("#redo").disabled = !history.future.length;
  $("#add").disabled = !p().background?.calibrated;
  $("#add").textContent = fixedMode ? "＋ 固定物" : "＋ 配置物";
  $("#fixed").classList.toggle("active", fixedMode);
  $("#fixed").textContent = fixedMode ? "固定物編集中" : "固定物を編集";
  $("#delete-stage").disabled = p().stages.length === 1;
  $("#left-stage").disabled = stageId === p().stages[0].id;
  $("#right-stage").disabled = stageId === p().stages.at(-1).id;
  $("#export").disabled = !p().background;
  renderCanvas();
  renderProperties();
  renderTracks();
}
function renderCanvas() {
  const project = p(),
    b = bounds(project, stageId),
    pad = project.grid.size * 2;
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
      const pos = isFixed ? e : stage().positions[e.id];
      if (!pos) continue;
      const active = selection?.id === e.id;
      const x = g.origin.x + pos.x,
        y = g.origin.y + pos.y;
      html += `<g data-id="${e.id}" data-fixed="${isFixed}" class="entity ${isFixed !== fixedMode ? "locked" : ""}" transform="translate(${x} ${y})"><rect width="${e.width}" height="${e.depth}" fill="${e.color}" fill-opacity=".8" stroke="${active ? "#073e64" : isFixed ? "#526675" : "#1b7066"}" stroke-width="${(active ? 3 : 1) / zoom}" ${isFixed ? 'stroke-dasharray="' + 4 / zoom + " " + 3 / zoom + '"' : ""}/><text x="${e.width / 2}" y="${e.depth / 2}" text-anchor="middle" dominant-baseline="central" fill="#102f3e" font-size="${Math.min(14 / zoom, e.depth * 0.35, e.width / Math.max(3, e.name.length))}" pointer-events="none">${esc(e.name)}</text></g>`;
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
    $("#properties").innerHTML =
      `<h2>${selection.fixed ? "固定物" : "配置物"}のプロパティ</h2><span class="badge">${selection.fixed ? "全時点で共通" : pos ? "この時点に配置済み" : "この時点では不在"}</span>${field("名称（全時点共通）", "name", e.name, "text", `${disabled} maxlength="200"`)}<div class="pair">${field("幅（mm）", "width", e.width, "number", `${disabled} min="${p().grid.size}" step="${p().grid.size}"`)}${field("奥行き（mm）", "depth", e.depth, "number", `${disabled} min="${p().grid.size}" step="${p().grid.size}"`)}</div>${field("色（全時点共通）", "color", e.color, "color", disabled)}<label for="memo">メモ（全時点共通）</label><textarea id="memo" maxlength="10000" ${disabled}>${esc(e.memo)}</textarea>${pos ? `<h3>${selection.fixed ? "共通の位置" : "この時点の位置"}</h3><div class="pair">${field("X（mm）", "x", pos.x, "number", `${disabled} step="${p().grid.size}"`)}${field("Y（mm）", "y", pos.y, "number", `${disabled} step="${p().grid.size}"`)}</div>` : ""}<div class="actions">${!pos ? `<button id="place" class="primary" ${disabled}>この時点に配置</button>` : `<button id="copy" ${disabled}>複製</button><button id="remove" class="danger" ${disabled}>${selection.fixed ? "固定物を削除" : "この時点から除去"}</button>`}<button id="deselect">図面の設定</button></div><p class="hint">${!editable() ? "編集モードを切り替えると変更できます。" : "属性の変更は全時点に反映されます。位置はグリッド原点からの距離です。"}</p>`;
    for (const key of ["name", "width", "depth", "color", "memo", "x", "y"]) {
      const input = $("#" + key);
      if (!input) continue;
      input.onchange = () =>
        update((next) => {
          const item = (selection.fixed ? next.fixed : next.entities).find(
            (v) => v.id === e.id,
          );
          if (["x", "y"].includes(key)) {
            const target = selection.fixed
              ? item
              : next.stages.find((s) => s.id === stageId).positions[e.id];
            const n = Number(input.value);
            if (!input.value.trim() || !Number.isFinite(n))
              throw Error("数値を入力してください。");
            target[key] = snap(n, next.grid.size);
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
          id: duplicateEntity(next, stageId, e.id, selection.fixed),
          fixed: selection.fixed,
        };
      }),
    );
    bind("remove", removeSelected);
    bind("place", () => {
      mode = "place";
      message(
        "キャンバスをクリックして配置してください。Escでキャンセルできます。",
      );
    });
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
    `<h2>図面の設定</h2><button id="load-image" ${isLocked ? "disabled" : ""}>${bg ? "背景画像を変更" : "背景画像を読み込む"}</button><p class="hint">PNG・JPEG / 画像は端末内で処理</p>${bg ? `<p>${esc(bg.name)}<br><span class="hint">${bg.width} × ${bg.height} px</span></p><span class="badge">${bg.calibrated ? "校正済み" : "縮尺の設定が必要"}</span><div class="actions"><button id="calibrate" ${isLocked ? "disabled" : ""}>2点で縮尺を設定</button></div><p class="hint">既知の距離の両端をクリックします。</p>` : "<p>まず背景図面を読み込み、実寸法に合わせてください。</p>"}<h3>グリッド</h3>${field("間隔（mm）", "grid-size", p().grid.size, "number", `min="0.001" step="any" ${isLocked ? "disabled" : ""}`)}<div class="actions"><button id="origin" ${isLocked || !bg?.calibrated ? "disabled" : ""}>原点を図面上で指定</button></div><p class="hint">原点：${p().grid.origin.x.toFixed(1)}, ${p().grid.origin.y.toFixed(1)} mm<br>${isLocked ? "配置物があるため、背景・縮尺・グリッドは固定されています。" : "配置を始める前に設定してください。"}</p><h3>操作</h3><p class="hint">ドラッグで移動 / Deleteで除去<br>Ctrl・⌘ + Zで元に戻す<br>Ctrl・⌘ + Sで保存<br>Escで操作をキャンセル</p>`;
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
function renderTracks() {
  const project = p();
  $("#tracks").innerHTML =
    `<table><thead><tr><th>配置物 / ${project.entities.length}</th>${project.stages.map((s) => `<th class="${s.id === stageId ? "selected" : ""}"><button data-stage="${s.id}">${esc(s.label)}</button></th>`).join("")}</tr></thead><tbody>${project.entities.map((e) => `<tr><td>${esc(e.name)}</td>${project.stages.map((s) => `<td class="${s.id === stageId ? "selected" : ""}"><button data-stage="${s.id}" data-entity="${e.id}" class="${s.positions[e.id] ? "present" : ""}" aria-label="${esc(e.name)}、${esc(s.label)}、${s.positions[e.id] ? "配置済み" : "不在"}" aria-pressed="${selection?.id === e.id && s.id === stageId}">${s.positions[e.id] ? "◆" : "—"}</button></td>`).join("")}</tr>`).join("")}</tbody></table>${!project.entities.length ? '<div class="empty">配置物を作成すると、時点ごとの存在をここで確認できます。</div>' : ""}`;
  $("#tracks")
    .querySelectorAll("[data-stage]")
    .forEach(
      (btn) =>
        (btn.onclick = () => {
          cancelMode();
          stageId = btn.dataset.stage;
          if (btn.dataset.entity) {
            fixedMode = false;
            selection = { id: btn.dataset.entity, fixed: false };
          }
          render();
          message(stage().label);
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
    } else if (mode === "place") {
      update((next) => {
        next.stages.find((s) => s.id === stageId).positions[selection.id] = {
          x: snap(pt.x - next.grid.origin.x, next.grid.size),
          y: snap(pt.y - next.grid.origin.y, next.grid.size),
        };
      });
      cancelMode();
      message("この時点に配置しました。");
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
    const target = selection.fixed
      ? next.fixed.find((e) => e.id === selection.id)
      : next.stages.find((s) => s.id === stageId).positions[selection.id];
    Object.assign(target, nextPos);
  });
});
svg.addEventListener("pointercancel", () => {
  drag = null;
  renderCanvas();
});
function removeSelected() {
  if (!selected() || !editable()) return;
  update((next) => {
    if (selection.fixed)
      next.fixed = next.fixed.filter((e) => e.id !== selection.id);
    else
      delete next.stages.find((s) => s.id === stageId).positions[selection.id];
  });
}
function fit() {
  const b = bounds(p(), stageId),
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
      ? "固定物の変更は全時点に反映されます。"
      : "配置物の位置は選択中の時点だけに反映されます。",
  );
});
bind("add", () => {
  cancelMode();
  update((next) => {
    selection = {
      id: createEntity(next, stageId, fixedMode),
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
bind("duplicate-stage", () => {
  cancelMode();
  update((next) => {
    stageId = duplicateStage(
      next,
      next.stages.findIndex((s) => s.id === stageId),
    );
  });
});
bind("rename-stage", () => {
  const label = prompt("時点の名前・日付", stage().label);
  if (label !== null)
    update((next) => {
      next.stages.find((s) => s.id === stageId).label = label;
    });
});
function moveStage(offset) {
  update((next) => {
    const i = next.stages.findIndex((s) => s.id === stageId),
      j = i + offset;
    if (j < 0 || j >= next.stages.length) return;
    [next.stages[i], next.stages[j]] = [next.stages[j], next.stages[i]];
  });
}
bind("left-stage", () => moveStage(-1));
bind("right-stage", () => moveStage(1));
bind("delete-stage", () => {
  if (p().stages.length < 2 || !confirm(`「${stage().label}」を削除しますか？`))
    return;
  cancelMode();
  update((next) => {
    const i = next.stages.findIndex((s) => s.id === stageId);
    next.stages.splice(i, 1);
    stageId = next.stages[Math.max(0, i - 1)].id;
  });
});
function canReplace() {
  return (
    !history.dirty || confirm("未保存の変更があります。破棄して続けますか？")
  );
}
function replace(project) {
  history = new History(project);
  stageId = project.stages[0].id;
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
    current = stageId;
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
    ctx.fillText(
      snapshot.stages.find((s) => s.id === current).label,
      padding,
      26,
      canvas.width - padding * 2,
    );
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
    const positions = snapshot.stages.find((s) => s.id === current).positions;
    for (const isFixed of [true, false])
      for (const e of isFixed ? snapshot.fixed : snapshot.entities) {
        const pos = isFixed ? e : positions[e.id];
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
    download(blob, "spatium-layout.png");
    message("選択中の時点をPNGで出力しました。");
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
          "Read the currently selected layout stage and entity counts.",
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
            stage: { id: stage().id, label: stage().label },
            entities: p().entities.map((e) => ({
              id: e.id,
              name: e.name,
              position: stage().positions[e.id] || null,
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
