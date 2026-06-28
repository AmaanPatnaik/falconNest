import { boundsOfContours, formatNumber, transformContours } from "../geometry/geometry.js";
import { exportSheetsDxf } from "../export/dxf.js";
import { importDxfFiles } from "../import/dxf.js";
import { nestPartsWithProgress } from "../nesting/nesting.js";
import { resetProject, state } from "../state/state.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const COLORS = ["#1f6feb", "#0f8b8d", "#ca8a04", "#7c3aed", "#047857", "#be123c"];

export function initializeUi() {
  const els = elements();
  bindSettings(els);
  bindToolbar(els);
  bindCanvas(els);
  render();
}

function elements() {
  return {
    fileInput: document.querySelector("#file-input"),
    newProject: document.querySelector("#new-project"),
    exportDxf: document.querySelector("#export-dxf"),
    nestButton: document.querySelector("#nest-button"),
    clearSheet: document.querySelector("#clear-sheet"),
    settingsToggle: document.querySelector("#settings-toggle"),
    settingsPanel: document.querySelector("#settings-panel"),
    canvas: document.querySelector("#canvas"),
    partsList: document.querySelector("#parts-list"),
    nestProgress: document.querySelector("#nest-progress"),
    iterationList: document.querySelector("#iteration-list"),
    warnings: document.querySelector("#warnings"),
    fitView: document.querySelector("#fit-view"),
    addManual: document.querySelector("#add-manual"),
    manualType: document.querySelector("#manual-type"),
    utilization: document.querySelector("#utilization"),
    waste: document.querySelector("#waste"),
    sheetCount: document.querySelector("#sheet-count"),
    partCount: document.querySelector("#part-count"),
    nestTime: document.querySelector("#nest-time"),
    inputs: {
      displayUnits: document.querySelectorAll("input[name='display-units']"),
      sheetWidth: document.querySelector("#sheet-width"),
      sheetHeight: document.querySelector("#sheet-height"),
      materialName: document.querySelector("#material-name"),
      spacing: document.querySelector("#spacing"),
      curveTolerance: document.querySelector("#curve-tolerance"),
      partRotations: document.querySelector("#part-rotations"),
      optimizationType: document.querySelector("#optimization-type"),
      showGrid: document.querySelector("#show-grid"),
      snapGrid: document.querySelector("#snap-grid"),
      showBounds: document.querySelector("#show-bounds"),
    },
  };
}

function bindSettings(els) {
  const update = () => {
    state.settings.displayUnits = [...els.inputs.displayUnits].find((input) => input.checked)?.value || "inch";
    state.settings.sheetWidth = positive(els.inputs.sheetWidth.value, state.settings.sheetWidth);
    state.settings.sheetHeight = positive(els.inputs.sheetHeight.value, state.settings.sheetHeight);
    state.settings.materialName = els.inputs.materialName.value.trim();
    state.settings.spacing = Math.max(0, Number(els.inputs.spacing.value) || 0);
    state.settings.curveTolerance = positive(els.inputs.curveTolerance.value, state.settings.curveTolerance);
    state.settings.partRotations = Math.max(1, Math.floor(Number(els.inputs.partRotations.value) || 1));
    state.parts.forEach((part) => {
      part.allowedRotations = state.settings.partRotations;
    });
    state.settings.optimizationType = els.inputs.optimizationType.value;
    state.settings.showGrid = els.inputs.showGrid.checked;
    state.settings.snapGrid = els.inputs.snapGrid.checked;
    state.settings.showBounds = els.inputs.showBounds.checked;
    render();
  };
  Object.values(els.inputs).forEach((input) => {
    if (input instanceof NodeList) input.forEach((node) => node.addEventListener("input", update));
    else input.addEventListener("input", update);
  });
}

function bindToolbar(els) {
  els.fileInput.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    const result = await importDxfFiles(files, state.settings);
    state.parts.push(...result.parts);
    state.warnings.push(...result.warnings);
    event.target.value = "";
    render();
  });
  els.nestButton.addEventListener("click", async () => {
    if (state.isNesting) return;
    state.isNesting = true;
    state.nestingProgress = 0;
    state.iterations = [];
    state.activeIteration = -1;
    state.placements = [];
    render();
    const result = await nestPartsWithProgress(state.parts, state.settings, (iteration) => {
      state.nestingProgress = iteration.total ? (iteration.index / iteration.total) * 100 : 0;
      state.iterations.push(iteration);
      state.activeIteration = state.iterations.length - 1;
      state.placements = iteration.placements;
      state.metrics = iteration.metrics;
      render();
    });
    state.placements = result.placements;
    state.metrics = result;
    state.nestingProgress = 100;
    state.isNesting = false;
    state.selectedId = result.placements[0]?.id || result.placements[0]?.part.instanceId || result.placements[0]?.part.id || null;
    fitView();
    render();
  });
  els.exportDxf.addEventListener("click", () => exportSheetsDxf(state));
  els.newProject.addEventListener("click", () => {
    resetProject();
    syncSettingsToInputs(els);
    render();
  });
  els.clearSheet.addEventListener("click", () => {
    state.placements = [];
    state.iterations = [];
    state.activeIteration = -1;
    state.nestingProgress = 0;
    state.metrics = { sheets: 0, utilization: 0, wasteArea: 0, nestingTimeMs: 0 };
    render();
  });
  els.settingsToggle.addEventListener("click", () => {
    const hidden = els.settingsPanel.toggleAttribute("hidden");
    els.settingsToggle.setAttribute("aria-expanded", String(!hidden));
  });
  els.fitView.addEventListener("click", () => {
    fitView();
    render();
  });
  els.addManual.addEventListener("click", () => {
    state.parts.push(createManualPart(els.manualType.value, state.settings));
    render();
  });
}

function bindCanvas(els) {
  let drag = null;
  els.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    state.zoom = Math.max(0.05, Math.min(50, state.zoom * factor));
    render();
  });
  els.canvas.addEventListener("pointerdown", (event) => {
    const target = event.target.closest?.("[data-placement-id]");
    if (target) {
      const id = target.getAttribute("data-placement-id");
      state.selectedId = id;
      const placement = state.placements.find((item) => placementId(item) === id);
      drag = placement ? { mode: "part", id, startX: event.clientX, startY: event.clientY, x: placement.x, y: placement.y } : null;
    } else {
      drag = { mode: "pan", startX: event.clientX, startY: event.clientY, x: state.pan.x, y: state.pan.y };
    }
    els.canvas.classList.add("dragging");
    els.canvas.setPointerCapture(event.pointerId);
    render();
  });
  els.canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / state.zoom;
    const dy = (event.clientY - drag.startY) / state.zoom;
    if (drag.mode === "pan") {
      state.pan.x = drag.x + event.clientX - drag.startX;
      state.pan.y = drag.y + event.clientY - drag.startY;
    } else {
      const placement = state.placements.find((item) => placementId(item) === drag.id);
      if (placement && !placement.locked) {
        placement.x = snap(drag.x + dx);
        placement.y = snap(drag.y + dy);
        placement.contours = transformContours(placement.part.contours, placement);
        placement.bounds = boundsOfContours(placement.contours);
      }
    }
    render();
  });
  els.canvas.addEventListener("pointerup", (event) => {
    drag = null;
    els.canvas.classList.remove("dragging");
    els.canvas.releasePointerCapture(event.pointerId);
  });
  window.addEventListener("keydown", (event) => {
    if (!state.selectedId) return;
    if (event.key === "Delete" || event.key === "Backspace") deleteSelected();
    if (event.key.toLowerCase() === "r") rotateSelected(event.shiftKey ? -15 : 15);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateSelected();
    }
  });
}

function render() {
  const els = elements();
  renderCanvas(els.canvas);
  renderParts(els.partsList);
  renderIterations(els.iterationList);
  renderWarnings(els.warnings);
  renderStatus(els);
  els.nestProgress.value = state.nestingProgress || 0;
  els.nestButton.disabled = state.isNesting;
  els.exportDxf.disabled = state.placements.length === 0;
}

function renderCanvas(svg) {
  svg.innerHTML = "";
  const width = svg.clientWidth || 1000;
  const height = svg.clientHeight || 700;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const root = createSvg("g", { transform: `translate(${state.pan.x} ${state.pan.y}) scale(${state.zoom})` });
  svg.append(root);
  if (state.settings.showGrid) drawGrid(root);
  drawSheets(root);
  state.placements.forEach((placement) => drawPlacement(root, placement));
}

function drawGrid(root) {
  const spacing = gridSpacing();
  const sheets = Math.max(1, state.metrics.sheets || 1);
  const totalHeight = sheets * (state.settings.sheetHeight + sheetGap()) - sheetGap();
  for (let x = 0; x <= state.settings.sheetWidth; x += spacing) {
    root.append(createSvg("line", { class: "grid-line", x1: x, y1: 0, x2: x, y2: totalHeight }));
  }
  for (let y = 0; y <= totalHeight; y += spacing) {
    root.append(createSvg("line", { class: "grid-line", x1: 0, y1: y, x2: state.settings.sheetWidth, y2: y }));
  }
}

function drawSheets(root) {
  const sheets = Math.max(1, state.metrics.sheets || 1);
  for (let i = 0; i < sheets; i += 1) {
    const y = i * (state.settings.sheetHeight + sheetGap());
    root.append(createSvg("rect", { class: "sheet", x: 0, y, width: state.settings.sheetWidth, height: state.settings.sheetHeight }));
    if (state.settings.materialName) root.append(createSvg("text", { class: "part-label", x: 8, y: y + 18 }, `${state.settings.materialName} ${i + 1}`));
  }
}

function drawPlacement(root, placement) {
  const group = createSvg("g", { "data-placement-id": placementId(placement) });
  const selected = state.selectedId === placementId(placement);
  placement.contours.forEach((contour) => {
    group.append(createSvg("path", { class: `part-shape${selected ? " selected" : ""}`, d: pathFromContour(contour), "data-placement-id": placementId(placement) }));
  });
  if (state.settings.showBounds) {
    group.append(createSvg("rect", {
      class: "part-bounds",
      x: placement.bounds.minX,
      y: placement.bounds.minY,
      width: placement.bounds.width,
      height: placement.bounds.height,
    }));
  }
  root.append(group);
}

function renderParts(list) {
  list.innerHTML = "";
  state.parts.forEach((part) => {
    const li = document.createElement("li");
    li.className = `part-card${state.selectedId?.startsWith(part.id) ? " selected" : ""}`;
    li.innerHTML = `
      <span class="part-name" title="${escapeHtml(part.name)}">${escapeHtml(part.name)}</span>
      <input class="part-quantity" aria-label="Quantity for ${escapeHtml(part.name)}" title="Quantity" type="number" min="0" step="1" value="${part.quantity}" data-action="quantity" />
      <button class="part-delete" type="button" data-action="delete" aria-label="Delete ${escapeHtml(part.name)}" title="Delete part">&#128465;</button>`;
    li.addEventListener("click", (event) => handlePartCardClick(event, part));
    li.addEventListener("input", (event) => handlePartCardInput(event, part));
    list.append(li);
  });
}

function handlePartCardClick(event, part) {
  const action = event.target.getAttribute("data-action");
  if (action === "quantity") return;
  if (action === "delete") {
    state.parts = state.parts.filter((item) => item.id !== part.id);
    state.placements = state.placements.filter((placement) => placement.part.id !== part.id);
    state.iterations = [];
    state.activeIteration = -1;
    state.nestingProgress = 0;
  }
  state.selectedId = part.id;
  render();
}

function handlePartCardInput(event, part) {
  const action = event.target.getAttribute("data-action");
  if (action === "quantity") part.quantity = Math.max(0, Math.floor(Number(event.target.value) || 0));
  renderStatus(elements());
}

function renderWarnings(container) {
  container.innerHTML = state.warnings.length ? `<h3>Warnings</h3><ul>${state.warnings.slice(-8).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : "";
}

function renderIterations(container) {
  container.innerHTML = "";
  state.iterations.forEach((iteration, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `iteration-button${index === state.activeIteration ? " active" : ""}`;
    button.textContent = String(iteration.index);
    button.title = `Iteration ${iteration.index} of ${iteration.total}`;
    button.addEventListener("click", () => {
      state.activeIteration = index;
      state.placements = iteration.placements;
      state.metrics = iteration.metrics;
      state.nestingProgress = iteration.total ? (iteration.index / iteration.total) * 100 : 0;
      render();
    });
    container.append(button);
  });
}

function renderStatus(els) {
  const totalParts = state.parts.reduce((sum, part) => sum + Number(part.quantity || 0), 0);
  els.utilization.textContent = `Material utilization: ${formatNumber(state.metrics.utilization || 0)}%`;
  els.waste.textContent = `Waste area: ${formatNumber(state.metrics.wasteArea || 0)} ${state.settings.displayUnits}²`;
  els.sheetCount.textContent = `Sheets: ${state.metrics.sheets || 0}`;
  els.partCount.textContent = `Total parts: ${totalParts}`;
  els.nestTime.textContent = `Nesting time: ${formatNumber(state.metrics.nestingTimeMs || 0)} ms`;
}

function deleteSelected() {
  if (!state.selectedId) return;
  state.placements = state.placements.filter((placement) => placementId(placement) !== state.selectedId);
  state.parts = state.parts.filter((part) => part.id !== state.selectedId);
  state.selectedId = null;
  render();
}

function duplicateSelected() {
  const placement = state.placements.find((item) => placementId(item) === state.selectedId);
  if (!placement) return;
  const duplicate = { ...placement, id: `${placementId(placement)}:copy:${Date.now()}`, x: placement.x + state.settings.spacing * 2, y: placement.y + state.settings.spacing * 2 };
  duplicate.contours = transformContours(duplicate.part.contours, duplicate);
  duplicate.bounds = boundsOfContours(duplicate.contours);
  state.placements.push(duplicate);
  render();
}

function rotateSelected(delta) {
  const placement = state.placements.find((item) => placementId(item) === state.selectedId);
  if (!placement || placement.locked) return;
  placement.rotation = (placement.rotation + delta + 360) % 360;
  placement.contours = transformContours(placement.part.contours, placement);
  placement.bounds = boundsOfContours(placement.contours);
  render();
}

function createManualPart(type, settings) {
  const w = settings.displayUnits === "mm" ? 100 : 4;
  const h = settings.displayUnits === "mm" ? 60 : 2.5;
  let contours;
  if (type === "circle") contours = [{ type: "circle", closed: true, center: { x: w / 2, y: w / 2 }, radius: w / 2, points: circlePoints(w / 2, w / 2, w / 2, 40) }];
  else if (type === "polygon") contours = [{ type: "polyline", closed: true, points: circlePoints(w / 2, w / 2, w / 2, 6) }];
  else if (type === "slot") contours = [{ type: "polyline", closed: true, points: slotPoints(w, h) }];
  else contours = [{ type: "polyline", closed: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }];
  const bounds = boundsOfContours(contours);
  const area = contours.reduce((sum, contour) => sum + Math.abs(polygonArea(contour.points)), 0);
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name: `${type} part`,
    quantity: 1,
    contours,
    bounds,
    area,
    unitsCode: settings.displayUnits === "mm" ? 4 : 1,
    allowedRotations: settings.partRotations,
    locked: false,
  };
}

function polygonArea(points) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function circlePoints(cx, cy, radius, count) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

function slotPoints(width, height) {
  const radius = height / 2;
  const points = [];
  for (let i = -8; i <= 8; i += 1) {
    const angle = (i / 8) * (Math.PI / 2);
    points.push({ x: width - radius + Math.cos(angle) * radius, y: radius + Math.sin(angle) * radius });
  }
  for (let i = 8; i <= 24; i += 1) {
    const angle = (i / 8) * (Math.PI / 2);
    points.push({ x: radius + Math.cos(angle) * radius, y: radius + Math.sin(angle) * radius });
  }
  return points;
}

function pathFromContour(contour) {
  if (!contour.points.length) return "";
  if (contour.type === "circle" && contour.center && contour.radius) {
    const left = { x: contour.center.x - contour.radius, y: contour.center.y };
    const right = { x: contour.center.x + contour.radius, y: contour.center.y };
    return `M ${formatNumber(right.x)} ${formatNumber(right.y)} A ${formatNumber(contour.radius)} ${formatNumber(contour.radius)} 0 1 1 ${formatNumber(left.x)} ${formatNumber(left.y)} A ${formatNumber(contour.radius)} ${formatNumber(contour.radius)} 0 1 1 ${formatNumber(right.x)} ${formatNumber(right.y)} Z`;
  }
  if (contour.type === "arc" && contour.center && contour.radius) {
    const start = pointOnCircle(contour.center, contour.radius, contour.startAngle || 0);
    const end = pointOnCircle(contour.center, contour.radius, contour.endAngle || 0);
    const sweep = normalizedSweep(contour.startAngle || 0, contour.endAngle || 0);
    return `M ${formatNumber(start.x)} ${formatNumber(start.y)} A ${formatNumber(contour.radius)} ${formatNumber(contour.radius)} 0 ${sweep > 180 ? 1 : 0} 1 ${formatNumber(end.x)} ${formatNumber(end.y)}`;
  }
  const points = contour.cadPoints || contour.points;
  const [first] = points;
  let path = `M ${formatNumber(first.x)} ${formatNumber(first.y)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    path += segmentToPath(points[i], points[i + 1]);
  }
  if (contour.closed) {
    path += segmentToPath(points[points.length - 1], first);
    path += " Z";
  }
  return path;
}

function segmentToPath(start, end) {
  if (!start.bulge) return ` L ${formatNumber(end.x)} ${formatNumber(end.y)}`;
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  const theta = 4 * Math.atan(start.bulge);
  const radius = Math.abs((chord * (1 + start.bulge * start.bulge)) / (4 * start.bulge));
  const largeArc = Math.abs(theta) > Math.PI ? 1 : 0;
  const sweep = start.bulge > 0 ? 1 : 0;
  return ` A ${formatNumber(radius)} ${formatNumber(radius)} 0 ${largeArc} ${sweep} ${formatNumber(end.x)} ${formatNumber(end.y)}`;
}

function pointOnCircle(center, radius, angleDeg) {
  const angle = (angleDeg * Math.PI) / 180;
  return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
}

function normalizedSweep(startAngle, endAngle) {
  return (endAngle - startAngle + 360) % 360 || 360;
}

function createSvg(tag, attrs = {}, text = "") {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  if (text) node.textContent = text;
  return node;
}

function fitView() {
  const canvas = document.querySelector("#canvas");
  const sheets = Math.max(1, state.metrics.sheets || 1);
  const totalHeight = sheets * (state.settings.sheetHeight + sheetGap()) - sheetGap();
  const scaleX = (canvas.clientWidth - 80) / state.settings.sheetWidth;
  const scaleY = (canvas.clientHeight - 80) / totalHeight;
  state.zoom = Math.max(0.05, Math.min(scaleX, scaleY));
  state.pan = { x: 40, y: 40 };
}

function syncSettingsToInputs(els) {
  els.inputs.sheetWidth.value = state.settings.sheetWidth;
  els.inputs.sheetHeight.value = state.settings.sheetHeight;
  els.inputs.materialName.value = state.settings.materialName;
  els.inputs.spacing.value = state.settings.spacing;
  els.inputs.curveTolerance.value = state.settings.curveTolerance;
  els.inputs.partRotations.value = state.settings.partRotations;
  els.inputs.optimizationType.value = state.settings.optimizationType;
  els.inputs.showGrid.checked = state.settings.showGrid;
  els.inputs.snapGrid.checked = state.settings.snapGrid;
  els.inputs.showBounds.checked = state.settings.showBounds;
}

function placementId(placement) {
  return placement.id || placement.part.instanceId || placement.part.id;
}

function sheetGap() {
  return Math.max(state.settings.sheetWidth, state.settings.sheetHeight) * 0.08;
}

function gridSpacing() {
  return state.settings.displayUnits === "mm" ? 10 : 1;
}

function snap(value) {
  if (!state.settings.snapGrid) return value;
  const grid = gridSpacing();
  return Math.round(value / grid) * grid;
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
