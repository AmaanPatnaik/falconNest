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
    points: entity.points.map((point) => ({ x: point.x - bounds.minX, y: point.y - bounds.minY })),
  }));

  return {
    name,
    entities: normalized,
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
  return { type: "polyline", closed: false, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] };
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
  return [{ type: "polyline", closed: true, points: arcPoints(cx, cy, r, 0, 360, 48) }];
}

function parseArc(block) {
  const cx = numberValue(block, 10);
  const cy = numberValue(block, 20);
  const r = numberValue(block, 40);
  const start = numberValue(block, 50);
  const end = numberValue(block, 51);
  if ([cx, cy, r, start, end].some((value) => value === null) || r <= 0) return [];
  return [{ type: "polyline", closed: false, points: arcPoints(cx, cy, r, start, end, 32) }];
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
  const sorted = [...state.parts].sort((a, b) => b.bounds.height - a.bounds.height || b.bounds.width - a.bounds.width);
  const placements = [];
  let sheet = 0;
  let x = spacing;
  let y = spacing;
  let rowHeight = 0;
  let overflow = 0;

  for (const part of sorted) {
    const width = part.bounds.width;
    const height = part.bounds.height;

    if (width + spacing * 2 > sheetWidth || height + spacing * 2 > sheetHeight) {
      placements.push({ part, sheet: -1, x: 0, y: 0 });
      overflow += 1;
      continue;
    }

    if (x + width + spacing > sheetWidth) {
      x = spacing;
      y += rowHeight + spacing;
      rowHeight = 0;
    }

    if (y + height + spacing > sheetHeight) {
      sheet += 1;
      x = spacing;
      y = spacing;
      rowHeight = 0;
    }

    placements.push({ part, sheet, x, y });
    x += width + spacing;
    rowHeight = Math.max(rowHeight, height);
  }

  state.placements = placements;
  state.lastSvg = buildSvg(placements, sheetWidth, sheetHeight);
  state.lastDxf = buildDxf(placements, sheetWidth, sheetHeight);
  els.saveDxf.disabled = !state.lastDxf;
  els.saveSvg.disabled = !state.lastSvg;

  const placed = placements.length - overflow;
  const sheets = placements.reduce((max, item) => Math.max(max, item.sheet), -1) + 1;
  setStatus(`Nested ${placed} part${placed === 1 ? "" : "s"} on ${sheets} sheet${sheets === 1 ? "" : "s"}.`, overflow > 0);
  render();
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
    content.push(partToSvg(placement.part, placement.x, placement.y + offsetY, COLORS[placement.sheet % COLORS.length]));
  }

  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${sheetWidth} ${Math.max(sheetHeight, totalHeight)}">${content.join("")}</svg>`;
}

function partToSvg(part, offsetX, offsetY, color) {
  return part.entities
    .map((entity) => {
      const points = entity.points.map((point) => `${round(point.x + offsetX)},${round(point.y + offsetY)}`);
      const close = entity.closed ? " Z" : "";
      return `<path d="M ${points.join(" L ")}${close}" fill="none" stroke="${color}" stroke-width="1"/>`;
    })
    .join("");
}

function buildDxf(placements, sheetWidth, sheetHeight) {
  const lines = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"];
  const visible = placements.filter((placement) => placement.sheet >= 0);
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
    for (const entity of placement.part.entities) {
      const points = entity.points.map((point) => ({ x: point.x + placement.x, y: point.y + placement.y + offsetY }));
      for (let i = 0; i < points.length - 1; i += 1) {
        addLine(lines, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, "PARTS");
      }
      if (entity.closed && points.length > 2) {
        const last = points[points.length - 1];
        const first = points[0];
        addLine(lines, last.x, last.y, first.x, first.y, "PARTS");
      }
    }
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

function addLine(lines, x1, y1, x2, y2, layer) {
  lines.push("0", "LINE", "8", layer, "10", String(round(x1)), "20", String(round(y1)), "11", String(round(x2)), "21", String(round(y2)));
}

function render() {
  renderParts();

  const sheetWidth = positiveNumber(els.sheetWidth.value, 1200);
  const sheetHeight = positiveNumber(els.sheetHeight.value, 600);
  const svg = state.placements.length ? state.lastSvg : buildSvg([], sheetWidth, sheetHeight);
  els.stage.innerHTML = svg.replace(/^<svg[^>]*>|<\/svg>$/g, "");
  els.stage.setAttribute("viewBox", getViewBox(svg, sheetWidth, sheetHeight));

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
    details.textContent = `${round(part.bounds.width)} x ${round(part.bounds.height)} ${els.units.value}, ${part.entities.length} entities`;
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
