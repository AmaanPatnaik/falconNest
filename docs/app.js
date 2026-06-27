"use strict";

const state = {
  parts: [],
  placements: [],
  lastSvg: "",
  lastDxf: "",
};

const els = {
  fileInput: document.querySelector("#file-input"),
  nestButton: document.querySelector("#nest-button"),
  saveDxf: document.querySelector("#save-dxf"),
  saveSvg: document.querySelector("#save-svg"),
  clearButton: document.querySelector("#clear-button"),
  sheetWidth: document.querySelector("#sheet-width"),
  sheetHeight: document.querySelector("#sheet-height"),
  spacing: document.querySelector("#spacing"),
  rotationStep: document.querySelector("#rotation-step"),
  units: document.querySelector("#units"),
  copies: document.querySelector("#copies"),
  status: document.querySelector("#status"),
  summary: document.querySelector("#summary"),
  stage: document.querySelector("#stage"),
  partsList: document.querySelector("#parts-list"),
};

const SVG_NS = "http://www.w3.org/2000/svg";
const COLORS = ["#1f6feb", "#0f8b8d", "#ca8a04", "#c2410c", "#7c3aed", "#047857"];

els.fileInput.addEventListener("change", handleFiles);
els.nestButton.addEventListener("click", nest);
els.saveDxf.addEventListener("click", () => saveText("falconnest-layout.dxf", state.lastDxf, "application/dxf"));
els.saveSvg.addEventListener("click", () => saveText("falconnest-layout.svg", state.lastSvg, "image/svg+xml"));
els.clearButton.addEventListener("click", clearAll);
for (const control of [els.sheetWidth, els.sheetHeight, els.spacing, els.rotationStep]) {
  control.addEventListener("input", () => {
    if (state.parts.length && state.placements.length) {
      nest();
    } else {
      render();
    }
  });
}
els.units.addEventListener("change", render);

render();

async function handleFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const copies = Math.max(1, Math.floor(Number(els.copies.value) || 1));
  let imported = 0;
  let skipped = 0;

  for (const file of files) {
    const text = await file.text();
    const parsed = parseDxf(text, file.name);
    if (!parsed.entities.length) {
      skipped += 1;
      continue;
    }

    for (let i = 0; i < copies; i += 1) {
      state.parts.push({
        ...parsed,
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        name: copies > 1 ? `${file.name} #${i + 1}` : file.name,
      });
      imported += 1;
    }
  }

  event.target.value = "";
  setStatus(imported ? `Imported ${imported} part${imported === 1 ? "" : "s"}.` : "No usable DXF geometry found.", skipped > 0);
  render();
}

function parseDxf(text, name) {
  const pairs = toPairs(text);
  const entities = [];
  const unitsCode = parseDxfUnits(pairs);
  let inEntities = false;

  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    if (pair.code === 0 && pair.value === "SECTION" && pairs[i + 1]?.code === 2 && pairs[i + 1]?.value === "ENTITIES") {
      inEntities = true;
      i += 1;
      continue;
    }
    if (inEntities && pair.code === 0 && pair.value === "ENDSEC") {
      break;
    }
    if (!inEntities || pair.code !== 0) {
      continue;
    }

    if (pair.value === "LINE") {
      const block = collectEntity(pairs, i + 1);
      const line = parseLine(block);
      if (line) entities.push(line);
    } else if (pair.value === "LWPOLYLINE") {
      const block = collectEntity(pairs, i + 1);
      entities.push(...parseLwPolyline(block));
    } else if (pair.value === "CIRCLE") {
      const block = collectEntity(pairs, i + 1);
      entities.push(...parseCircle(block));
    } else if (pair.value === "ARC") {
      const block = collectEntity(pairs, i + 1);
      entities.push(...parseArc(block));
    }
  }

  const bounds = getBounds(entities);
  const normalized = entities.map((entity) => ({
    ...entity,
    points: entity.points.map((point) => ({ ...point, x: point.x - bounds.minX, y: point.y - bounds.minY })),
    center: entity.center ? { x: entity.center.x - bounds.minX, y: entity.center.y - bounds.minY } : undefined,
  }));

  return {
    name,
    unitsCode,
    entities: normalized,
    originalBounds: bounds,
    bounds: {
      minX: 0,
      minY: 0,
      maxX: bounds.width,
      maxY: bounds.height,
      width: bounds.width,
      height: bounds.height,
    },
  };
}

function parseDxfUnits(pairs) {
  for (let i = 0; i < pairs.length - 1; i += 1) {
    if (pairs[i].code === 9 && pairs[i].value === "$INSUNITS" && pairs[i + 1].code === 70) {
      const code = Number(pairs[i + 1].value);
      return Number.isFinite(code) ? code : 0;
    }
  }
  return 0;
}

function toPairs(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const pairs = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    pairs.push({ code: Number(lines[i].trim()), value: lines[i + 1].trim() });
  }
  return pairs;
}

function collectEntity(pairs, start) {
  const block = [];
  for (let i = start; i < pairs.length; i += 1) {
    if (pairs[i].code === 0) break;
    block.push(pairs[i]);
  }
  return block;
}

function parseLine(block) {
  const x1 = numberValue(block, 10);
  const y1 = numberValue(block, 20);
  const x2 = numberValue(block, 11);
  const y2 = numberValue(block, 21);
  if ([x1, y1, x2, y2].some((value) => value === null)) return null;
  return { type: "line", closed: false, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] };
}

function parseLwPolyline(block) {
  const points = [];
  let current = null;
  const closed = (numberValue(block, 70) || 0) & 1;

  for (const pair of block) {
    if (pair.code === 10) {
      current = { x: Number(pair.value), y: 0 };
      points.push(current);
    } else if (pair.code === 20 && current) {
      current.y = Number(pair.value);
    } else if (pair.code === 42 && current) {
      current.bulge = Number(pair.value);
    }
  }

  if (points.length < 2) return [];
  return [{ type: "polyline", closed: Boolean(closed), points }];
}

function parseCircle(block) {
  const cx = numberValue(block, 10);
  const cy = numberValue(block, 20);
  const r = numberValue(block, 40);
  if ([cx, cy, r].some((value) => value === null) || r <= 0) return [];
  return [{ type: "circle", closed: true, center: { x: cx, y: cy }, radius: r, points: arcPoints(cx, cy, r, 0, 360, 96) }];
}

function parseArc(block) {
  const cx = numberValue(block, 10);
  const cy = numberValue(block, 20);
  const r = numberValue(block, 40);
  const start = numberValue(block, 50);
  const end = numberValue(block, 51);
  if ([cx, cy, r, start, end].some((value) => value === null) || r <= 0) return [];
  return [{
    type: "arc",
    closed: false,
    center: { x: cx, y: cy },
    radius: r,
    startAngle: start,
    endAngle: end,
    points: arcPoints(cx, cy, r, start, end, 64),
  }];
}

function arcPoints(cx, cy, r, startDeg, endDeg, segments) {
  let sweep = endDeg - startDeg;
  if (sweep <= 0) sweep += 360;
  const count = Math.max(6, Math.ceil((segments * sweep) / 360));
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const angle = ((startDeg + (sweep * i) / count) * Math.PI) / 180;
    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }
  return points;
}

function numberValue(block, code) {
  const pair = block.find((item) => item.code === code);
  if (!pair) return null;
  const value = Number(pair.value);
  return Number.isFinite(value) ? value : null;
}

function nest() {
  if (!state.parts.length) {
    setStatus("Import DXF files before nesting.", true);
    return;
  }

  const sheetWidth = positiveNumber(els.sheetWidth.value, 1200);
  const sheetHeight = positiveNumber(els.sheetHeight.value, 600);
  const spacing = Math.max(0, Number(els.spacing.value) || 0);
  const rotationStep = clamp(Math.floor(Number(els.rotationStep.value) || 15), 1, 360);
  const sorted = [...state.parts].sort((a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height);
  const placements = [];
  let sheet = 0;
  let x = spacing;
  let y = spacing;
  let rowHeight = 0;
  let overflow = 0;

  for (const part of sorted) {
    let rotated = bestRotationForSlot(part, sheetWidth - spacing * 2, sheetHeight - spacing * 2, rotationStep);

    if (!rotated) {
      placements.push({ part, sheet: -1, x: 0, y: 0 });
      overflow += 1;
      continue;
    }

    rotated = bestRotationForSlot(part, sheetWidth - x - spacing, sheetHeight - y - spacing, rotationStep);

    if (!rotated) {
      x = spacing;
      y += rowHeight + spacing;
      rowHeight = 0;
      rotated = bestRotationForSlot(part, sheetWidth - x - spacing, sheetHeight - y - spacing, rotationStep);
    }

    if (!rotated) {
      sheet += 1;
      x = spacing;
      y = spacing;
      rowHeight = 0;
      rotated = bestRotationForSlot(part, sheetWidth - x - spacing, sheetHeight - y - spacing, rotationStep);
    }

    placements.push({ part, sheet, x, y, angle: rotated.angle, bounds: rotated.bounds });
    x += rotated.bounds.width + spacing;
    rowHeight = Math.max(rowHeight, rotated.bounds.height);
  }

  state.placements = placements;
  state.lastSvg = buildSvg(placements, sheetWidth, sheetHeight);
  state.lastDxf = buildDxf(placements, sheetWidth, sheetHeight);
  els.saveDxf.disabled = !state.lastDxf;
  els.saveSvg.disabled = !state.lastSvg;

  const placed = placements.length - overflow;
  const sheets = placements.reduce((max, item) => Math.max(max, item.sheet), -1) + 1;
  setStatus(`Nested ${placed} part${placed === 1 ? "" : "s"} on ${sheets} sheet${sheets === 1 ? "" : "s"} with ${rotationStep} degree rotation steps.`, overflow > 0);
  render();
}

function bestRotationForSlot(part, availableWidth, availableHeight, rotationStep) {
  let best = null;
  for (let angle = 0; angle < 360; angle += rotationStep) {
    const bounds = getRotatedPartBounds(part, angle);
    if (bounds.width <= availableWidth && bounds.height <= availableHeight) {
      const waste = availableWidth * availableHeight - bounds.width * bounds.height;
      const score = waste + bounds.height * 0.1;
      if (!best || score < best.score) {
        best = { angle, bounds, score };
      }
    }
  }
  return best;
}

function getRotatedPartBounds(part, angle) {
  const points = part.entities.flatMap((entity) => entity.points.map((point) => rotatePoint(point, angle)));
  return getBounds([{ points }]);
}

function buildSvg(placements, sheetWidth, sheetHeight) {
  const visible = placements.filter((placement) => placement.sheet >= 0);
  const sheets = visible.reduce((max, item) => Math.max(max, item.sheet), -1) + 1;
  const gap = Math.max(sheetWidth, sheetHeight) * 0.06;
  const totalHeight = sheets * sheetHeight + Math.max(0, sheets - 1) * gap;
  const content = [];

  for (let i = 0; i < sheets; i += 1) {
    const offsetY = i * (sheetHeight + gap);
    content.push(`<rect x="0" y="${offsetY}" width="${sheetWidth}" height="${sheetHeight}" fill="none" stroke="#8a96a8" stroke-width="1"/>`);
  }

  for (const placement of visible) {
    const offsetY = placement.sheet * (sheetHeight + gap);
    const rotatedBounds = getRotatedPartBounds(placement.part, placement.angle || 0);
    content.push(partToSvg(placement.part, placement.x, placement.y + offsetY, placement.angle || 0, rotatedBounds, COLORS[placement.sheet % COLORS.length]));
  }

  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${sheetWidth} ${Math.max(sheetHeight, totalHeight)}">${content.join("")}</svg>`;
}

function partToSvg(part, offsetX, offsetY, angle, rotatedBounds, color) {
  return part.entities
    .map((entity) => {
      const points = entity.points.map((point) => {
        const rotated = rotatePoint(point, angle);
        return `${formatNumber(rotated.x - rotatedBounds.minX + offsetX)},${formatNumber(rotated.y - rotatedBounds.minY + offsetY)}`;
      });
      const close = entity.closed ? " Z" : "";
      return `<path d="M ${points.join(" L ")}${close}" fill="none" stroke="${color}" stroke-width="1"/>`;
    })
    .join("");
}

function buildDxf(placements, sheetWidth, sheetHeight) {
  const visible = placements.filter((placement) => placement.sheet >= 0);
  const unitsCode = firstUnitsCode(visible);
  const lines = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$INSUNITS", "70", String(unitsCode), "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"];
  const gap = Math.max(sheetWidth, sheetHeight) * 0.06;
  const sheets = visible.reduce((max, item) => Math.max(max, item.sheet), -1) + 1;

  for (let i = 0; i < sheets; i += 1) {
    const y = i * (sheetHeight + gap);
    addLine(lines, 0, y, sheetWidth, y, "SHEET");
    addLine(lines, sheetWidth, y, sheetWidth, y + sheetHeight, "SHEET");
    addLine(lines, sheetWidth, y + sheetHeight, 0, y + sheetHeight, "SHEET");
    addLine(lines, 0, y + sheetHeight, 0, y, "SHEET");
  }

  for (const placement of visible) {
    const offsetY = placement.sheet * (sheetHeight + gap);
    const rotatedBounds = getRotatedPartBounds(placement.part, placement.angle || 0);
    for (const entity of placement.part.entities) {
      addDxfEntity(lines, entity, placement, offsetY, rotatedBounds);
    }
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

function addLine(lines, x1, y1, x2, y2, layer) {
  lines.push("0", "LINE", "8", layer, "10", formatNumber(x1), "20", formatNumber(y1), "11", formatNumber(x2), "21", formatNumber(y2));
}

function addDxfEntity(lines, entity, placement, sheetOffsetY, rotatedBounds) {
  const transform = (point) => transformPoint(point, placement, sheetOffsetY, rotatedBounds);
  if (entity.type === "line") {
    const start = transform(entity.points[0]);
    const end = transform(entity.points[1]);
    addLine(lines, start.x, start.y, end.x, end.y, "PARTS");
    return;
  }

  if (entity.type === "circle" && entity.center && entity.radius) {
    const center = transform(entity.center);
    lines.push("0", "CIRCLE", "8", "PARTS", "10", formatNumber(center.x), "20", formatNumber(center.y), "40", formatNumber(entity.radius));
    return;
  }

  if (entity.type === "arc" && entity.center && entity.radius) {
    const center = transform(entity.center);
    const angle = placement.angle || 0;
    lines.push(
      "0",
      "ARC",
      "8",
      "PARTS",
      "10",
      formatNumber(center.x),
      "20",
      formatNumber(center.y),
      "40",
      formatNumber(entity.radius),
      "50",
      formatNumber(normalizeAngle((entity.startAngle || 0) + angle)),
      "51",
      formatNumber(normalizeAngle((entity.endAngle || 0) + angle))
    );
    return;
  }

  const points = entity.points.map((point) => ({ ...transform(point), bulge: point.bulge }));
  addPolyline(lines, points, entity.closed, "PARTS");
}

function addPolyline(lines, points, closed, layer) {
  lines.push("0", "LWPOLYLINE", "8", layer, "90", String(points.length), "70", closed ? "1" : "0");
  for (const point of points) {
    lines.push("10", formatNumber(point.x), "20", formatNumber(point.y));
    if (point.bulge) {
      lines.push("42", formatNumber(point.bulge));
    }
  }
}

function render() {
  renderParts();

  const sheetWidth = positiveNumber(els.sheetWidth.value, 1200);
  const sheetHeight = positiveNumber(els.sheetHeight.value, 600);
  const svg = state.placements.length ? buildSvg(state.placements, sheetWidth, sheetHeight) : buildSvg([], sheetWidth, sheetHeight);
  els.stage.innerHTML = svg.replace(/^<svg[^>]*>|<\/svg>$/g, "");
  const viewBox = getViewBox(svg, sheetWidth, sheetHeight);
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  els.stage.setAttribute("viewBox", viewBox);
  els.stage.style.width = `${Math.max(width, 1)}px`;
  els.stage.style.height = `${Math.max(height, 1)}px`;

  const totalArea = state.parts.reduce((sum, part) => sum + part.bounds.width * part.bounds.height, 0);
  els.summary.textContent = state.parts.length ? `${state.parts.length} parts, ${round(totalArea)} square ${els.units.value}` : "";
}

function renderParts() {
  els.partsList.innerHTML = "";
  for (const part of state.parts) {
    const li = document.createElement("li");
    const title = document.createElement("strong");
    const details = document.createElement("small");
    title.textContent = part.name;
    details.textContent = `${formatNumber(part.bounds.width)} x ${formatNumber(part.bounds.height)} ${els.units.value}, ${part.entities.length} entities`;
    li.append(title, details);
    els.partsList.append(li);
  }
}

function getViewBox(svg, fallbackWidth, fallbackHeight) {
  const match = svg.match(/viewBox="([^"]+)"/);
  return match ? match[1] : `0 0 ${fallbackWidth} ${fallbackHeight}`;
}

function getBounds(entities) {
  const points = entities.flatMap((entity) => entity.points);
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function formatNumber(value) {
  return String(Number(round(value).toFixed(3)));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rotatePoint(point, angle) {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function transformPoint(point, placement, sheetOffsetY, rotatedBounds) {
  const rotated = rotatePoint(point, placement.angle || 0);
  return {
    x: rotated.x - rotatedBounds.minX + placement.x,
    y: rotated.y - rotatedBounds.minY + placement.y + sheetOffsetY,
  };
}

function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360;
}

function firstUnitsCode(placements) {
  const part = placements.find((placement) => placement.part.unitsCode !== undefined)?.part;
  return part ? part.unitsCode : unitCodeFromUi();
}

function unitCodeFromUi() {
  return els.units.value === "inch" ? 1 : 4;
}

function saveText(filename, text, type) {
  if (!text) return;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function clearAll() {
  state.parts = [];
  state.placements = [];
  state.lastSvg = "";
  state.lastDxf = "";
  els.saveDxf.disabled = true;
  els.saveSvg.disabled = true;
  setStatus("Import one or more DXF files to begin.");
  render();
}

function setStatus(text, isWarning = false) {
  els.status.textContent = text;
  els.status.classList.toggle("warning", isWarning);
}
