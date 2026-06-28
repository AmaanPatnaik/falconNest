import {
  approximateArc,
  boundsOfContours,
  contourArea,
  hasDuplicateContour,
  normalizeContours,
  polygonSelfIntersects,
  removeDuplicatePoints,
} from "../geometry/geometry.js";
import { partArea } from "../nesting/nesting.js";

export async function importDxfFiles(files, settings) {
  const parts = [];
  const warnings = [];
  for (const file of files) {
    const text = await file.text();
    const parsed = parseDxf(text, file.name, settings);
    warnings.push(...parsed.warnings);
    if (parsed.part) parts.push(parsed.part);
  }
  return { parts, warnings };
}

export function parseDxf(text, filename, settings) {
  const pairs = toPairs(text);
  const unitsCode = parseUnits(pairs) || unitCodeFromDisplay(settings.displayUnits);
  const rawContours = parseEntities(pairs, settings.curveTolerance);
  const warnings = [];
  const seen = new Set();
  const contours = rawContours
    .map((contour) => ({ ...contour, points: removeDuplicatePoints(contour.points) }))
    .filter((contour) => contour.points.length >= 2);

  for (const contour of contours) {
    if (!contour.closed) warnings.push(`${filename}: open contour detected.`);
    if (contour.closed && polygonSelfIntersects(contour)) warnings.push(`${filename}: self-intersection detected.`);
    if (hasDuplicateContour(contour, seen)) warnings.push(`${filename}: duplicate entity detected and kept once.`);
  }

  const uniqueContours = [];
  const uniqueKeys = new Set();
  for (const contour of contours) {
    const key = contour.points.map((point) => `${point.x.toFixed(5)},${point.y.toFixed(5)}`).join("|");
    if (uniqueKeys.has(key)) continue;
    uniqueKeys.add(key);
    uniqueContours.push(contour);
  }

  if (!uniqueContours.length) return { part: null, warnings: [`${filename}: no supported DXF entities found.`] };

  const normalized = normalizeContours(uniqueContours);
  const bounds = boundsOfContours(normalized);
  const area = partArea(normalized);
  if (area <= 0) warnings.push(`${filename}: no closed contour area found; part can be previewed but may not nest reliably.`);

  return {
    warnings,
    part: {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      name: filename,
      sourceName: filename,
      quantity: 1,
      contours: normalized,
      originalContours: uniqueContours,
      unitsCode,
      bounds,
      area: Math.max(0, area),
      locked: false,
      allowedRotations: settings.partRotations,
    },
  };
}

function parseEntities(pairs, tolerance) {
  const contours = [];
  let inEntities = false;
  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    if (pair.code === 0 && pair.value === "SECTION" && pairs[i + 1]?.code === 2 && pairs[i + 1]?.value === "ENTITIES") {
      inEntities = true;
      i += 1;
      continue;
    }
    if (inEntities && pair.code === 0 && pair.value === "ENDSEC") break;
    if (!inEntities || pair.code !== 0) continue;
    const block = collectEntity(pairs, i + 1);
    if (pair.value === "LINE") contours.push(parseLine(block));
    if (pair.value === "LWPOLYLINE") contours.push(parseLwPolyline(block, tolerance));
    if (pair.value === "POLYLINE") {
      const result = parsePolyline(pairs, i + 1, tolerance);
      contours.push(result.contour);
      i = result.endIndex;
    }
    if (pair.value === "CIRCLE") contours.push(parseCircle(block, tolerance));
    if (pair.value === "ARC") contours.push(parseArc(block, tolerance));
  }
  return contours.filter(Boolean);
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

function numberValue(block, code) {
  const pair = block.find((item) => item.code === code);
  if (!pair) return null;
  const value = Number(pair.value);
  return Number.isFinite(value) ? value : null;
}

function parseLine(block) {
  const x1 = numberValue(block, 10);
  const y1 = numberValue(block, 20);
  const x2 = numberValue(block, 11);
  const y2 = numberValue(block, 21);
  if ([x1, y1, x2, y2].some((value) => value === null)) return null;
  return { type: "line", closed: false, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] };
}

function parseLwPolyline(block, tolerance) {
  const points = [];
  let current = null;
  const closed = Boolean((numberValue(block, 70) || 0) & 1);
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
  return points.length >= 2 ? { type: "polyline", closed, cadPoints: points, points: approximateBulgedPolyline(points, closed, tolerance) } : null;
}

function parsePolyline(pairs, start, tolerance) {
  const points = [];
  let endIndex = start;
  for (let i = start; i < pairs.length; i += 1) {
    endIndex = i;
    if (pairs[i].code === 0 && pairs[i].value === "SEQEND") break;
    if (pairs[i].code === 0 && pairs[i].value === "VERTEX") {
      const block = collectEntity(pairs, i + 1);
      const x = numberValue(block, 10);
      const y = numberValue(block, 20);
      if (x !== null && y !== null) points.push({ x, y, bulge: numberValue(block, 42) || undefined });
    }
  }
  const closed = points.length > 2 && contourArea(points) !== 0;
  return { contour: points.length >= 2 ? { type: "polyline", closed, cadPoints: points, points: approximateBulgedPolyline(points, closed, tolerance) } : null, endIndex };
}

function approximateBulgedPolyline(points, closed, tolerance) {
  const output = [];
  const limit = closed ? points.length : points.length - 1;
  for (let i = 0; i < limit; i += 1) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    if (!output.length) output.push({ x: start.x, y: start.y });
    if (start.bulge) {
      output.push(...bulgeSegmentPoints(start, end, tolerance).slice(1));
    } else {
      output.push({ x: end.x, y: end.y });
    }
  }
  return output;
}

function bulgeSegmentPoints(start, end, tolerance) {
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  if (!chord || !start.bulge) return [start, end];
  const theta = 4 * Math.atan(start.bulge);
  const radius = Math.abs((chord * (1 + start.bulge * start.bulge)) / (4 * start.bulge));
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const sagitta = (start.bulge * chord) / 2;
  const normal = { x: -(end.y - start.y) / chord, y: (end.x - start.x) / chord };
  const centerDistance = radius - Math.abs(sagitta);
  const centerSign = start.bulge > 0 ? 1 : -1;
  const center = {
    x: midpoint.x + normal.x * centerDistance * centerSign,
    y: midpoint.y + normal.y * centerDistance * centerSign,
  };
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const safeTolerance = Math.max(tolerance, radius / 10000, 1e-7);
  const angleStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - safeTolerance / radius)));
  const segments = Math.max(2, Math.ceil(Math.abs(theta) / angleStep));
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = startAngle + (theta * index) / segments;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

function parseCircle(block, tolerance) {
  const cx = numberValue(block, 10);
  const cy = numberValue(block, 20);
  const radius = numberValue(block, 40);
  if ([cx, cy, radius].some((value) => value === null) || radius <= 0) return null;
  return { type: "circle", closed: true, center: { x: cx, y: cy }, radius, points: approximateArc(cx, cy, radius, 0, 360, tolerance) };
}

function parseArc(block, tolerance) {
  const cx = numberValue(block, 10);
  const cy = numberValue(block, 20);
  const radius = numberValue(block, 40);
  const startAngle = numberValue(block, 50);
  const endAngle = numberValue(block, 51);
  if ([cx, cy, radius, startAngle, endAngle].some((value) => value === null) || radius <= 0) return null;
  return {
    type: "arc",
    closed: false,
    center: { x: cx, y: cy },
    radius,
    startAngle,
    endAngle,
    points: approximateArc(cx, cy, radius, startAngle, endAngle, tolerance),
  };
}

function parseUnits(pairs) {
  for (let i = 0; i < pairs.length - 1; i += 1) {
    if (pairs[i].code === 9 && pairs[i].value === "$INSUNITS" && pairs[i + 1].code === 70) {
      const value = Number(pairs[i + 1].value);
      return Number.isFinite(value) ? value : 0;
    }
  }
  return 0;
}

function unitCodeFromDisplay(units) {
  return units === "mm" ? 4 : 1;
}
