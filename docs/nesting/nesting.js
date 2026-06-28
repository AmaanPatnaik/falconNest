import { boundsOfContours, contourArea, contoursCollide, contoursTooClose, transformContours, transformedBounds } from "../geometry/geometry.js";

const FIT_EPSILON = 1e-7;

export function allowedRotations(count) {
  const rotations = Math.max(1, Math.floor(count || 1));
  const step = 360 / rotations;
  return Array.from({ length: rotations }, (_, index) => index * step);
}

export function expandedParts(parts) {
  return parts.flatMap((part) =>
    Array.from({ length: Math.max(0, Math.floor(part.quantity || 0)) }, (_, copyIndex) => ({
      ...part,
      instanceId: `${part.id}:${copyIndex + 1}`,
      copyIndex: copyIndex + 1,
    }))
  );
}

export function nestParts(parts, settings) {
  const start = performance.now();
  const spacing = Math.max(0, settings.spacing || 0);
  const sheetWidth = settings.sheetWidth;
  const sheetHeight = settings.sheetHeight;
  const step = Math.max(spacing || Math.min(sheetWidth, sheetHeight) / 160, Math.min(sheetWidth, sheetHeight) / 160);
  const candidates = expandedParts(parts).sort((a, b) => b.area - a.area || b.bounds.height - a.bounds.height);
  const placements = [];

  for (const part of candidates) {
    let sheetIndex = 0;
    let placement = null;
    while (!placement) {
      const rotations = allowedRotations(part.allowedRotations || settings.partRotations);
      placement = findPlacement(part, sheetIndex, placements, rotations, { sheetWidth, sheetHeight, spacing, step, mode: settings.optimizationType });
      if (!placement) sheetIndex += 1;
    }
    placements.push(placement);
  }

  const usedSheets = placements.reduce((max, placement) => Math.max(max, placement.sheetIndex), -1) + 1;
  const partArea = placements.reduce((sum, placement) => sum + placement.part.area, 0);
  const sheetArea = usedSheets * sheetWidth * sheetHeight;
  return {
    placements,
    sheets: usedSheets,
    utilization: sheetArea ? (partArea / sheetArea) * 100 : 0,
    wasteArea: Math.max(0, sheetArea - partArea),
    nestingTimeMs: performance.now() - start,
  };
}

export async function nestPartsWithProgress(parts, settings, onIteration) {
  const start = performance.now();
  const spacing = Math.max(0, settings.spacing || 0);
  const sheetWidth = settings.sheetWidth;
  const sheetHeight = settings.sheetHeight;
  const step = Math.max(spacing || Math.min(sheetWidth, sheetHeight) / 160, Math.min(sheetWidth, sheetHeight) / 160);
  const candidates = expandedParts(parts).sort((a, b) => b.area - a.area || b.bounds.height - a.bounds.height);
  const placements = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const part = candidates[index];
    let sheetIndex = 0;
    let placement = null;
    while (!placement) {
      const rotations = allowedRotations(part.allowedRotations || settings.partRotations);
      placement = findPlacement(part, sheetIndex, placements, rotations, { sheetWidth, sheetHeight, spacing, step, mode: settings.optimizationType });
      if (!placement) sheetIndex += 1;
    }
    placements.push(placement);
    const metrics = buildMetrics(placements, sheetWidth, sheetHeight, performance.now() - start);
    onIteration?.({
      index: index + 1,
      total: candidates.length,
      placements: clonePlacements(placements),
      metrics,
    });
    await nextFrame();
  }

  return {
    placements,
    ...buildMetrics(placements, sheetWidth, sheetHeight, performance.now() - start),
  };
}

function findPlacement(part, sheetIndex, existing, rotations, options) {
  let best = null;
  for (const rotation of rotations) {
    const bounds = transformedBounds(part.contours, rotation);
    if (bounds.width + options.spacing * 2 > options.sheetWidth + FIT_EPSILON || bounds.height + options.spacing * 2 > options.sheetHeight + FIT_EPSILON) continue;

    const maxX = options.sheetWidth - bounds.width - options.spacing;
    const maxY = options.sheetHeight - bounds.height - options.spacing;
    for (let y = options.spacing; y <= maxY + 1e-7; y += options.step) {
      for (let x = options.spacing; x <= maxX + 1e-7; x += options.step) {
        const candidate = makePlacement(part, sheetIndex, x, y, rotation, bounds);
        if (!fits(candidate, existing, options)) continue;
        const score = scorePlacement(candidate, existing, options);
        if (!best || score < best.score) best = { ...candidate, score };
      }
    }
  }
  if (!best) return null;
  delete best.score;
  return best;
}

function makePlacement(part, sheetIndex, x, y, rotation, bounds) {
  const contours = transformContours(part.contours, { x, y, rotation });
  return { id: `${part.instanceId || part.id}@${sheetIndex}:${x.toFixed(4)}:${y.toFixed(4)}:${rotation}`, part, sheetIndex, x, y, rotation, bounds: boundsOfContours(contours), contours, locked: !!part.locked };
}

function buildMetrics(placements, sheetWidth, sheetHeight, nestingTimeMs) {
  const usedSheets = placements.reduce((max, placement) => Math.max(max, placement.sheetIndex), -1) + 1;
  const partArea = placements.reduce((sum, placement) => sum + placement.part.area, 0);
  const sheetArea = usedSheets * sheetWidth * sheetHeight;
  return {
    sheets: usedSheets,
    utilization: sheetArea ? (partArea / sheetArea) * 100 : 0,
    wasteArea: Math.max(0, sheetArea - partArea),
    nestingTimeMs,
  };
}

function clonePlacements(placements) {
  return placements.map((placement) => ({
    ...placement,
    bounds: { ...placement.bounds },
    contours: placement.contours.map((contour) => ({
      ...contour,
      points: contour.points.map((point) => ({ ...point })),
      cadPoints: contour.cadPoints?.map((point) => ({ ...point })),
      center: contour.center ? { ...contour.center } : undefined,
    })),
  }));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function fits(candidate, existing, options) {
  if (candidate.bounds.minX < options.spacing - 1e-7 || candidate.bounds.minY < options.spacing - 1e-7) return false;
  if (candidate.bounds.maxX > options.sheetWidth - options.spacing + 1e-7) return false;
  if (candidate.bounds.maxY > options.sheetHeight - options.spacing + 1e-7) return false;
  for (const placed of existing) {
    if (placed.sheetIndex !== candidate.sheetIndex) continue;
    const broadphaseBounds = inflateBounds(placed.bounds, options.spacing);
    if (!boundsOverlap(candidate.bounds, broadphaseBounds)) continue;
    if (contoursCollide(candidate.contours, placed.contours)) return false;
    if (contoursTooClose(candidate.contours, placed.contours, options.spacing)) return false;
  }
  return true;
}

function scorePlacement(candidate, existing, options) {
  const sheetPlacements = existing.filter((placement) => placement.sheetIndex === candidate.sheetIndex);
  const bounds = combinedBounds([...sheetPlacements, candidate]);
  if (options.mode === "gravity") return bounds.width * 1000 + candidate.y + candidate.x * 0.01;
  if (options.mode === "squeeze") return occupiedArea([...sheetPlacements, candidate]) + bounds.width + bounds.height;
  return bounds.width * bounds.height + candidate.y + candidate.x * 0.01;
}

function occupiedArea(placements) {
  return placements.reduce((sum, placement) => sum + placement.part.area, 0);
}

function combinedBounds(placements) {
  if (!placements.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const minX = Math.min(...placements.map((placement) => placement.bounds.minX));
  const minY = Math.min(...placements.map((placement) => placement.bounds.minY));
  const maxX = Math.max(...placements.map((placement) => placement.bounds.maxX));
  const maxY = Math.max(...placements.map((placement) => placement.bounds.maxY));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function boundsOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function inflateBounds(bounds, amount) {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

export function partArea(contours) {
  const closed = contours.filter((contour) => contour.closed);
  if (!closed.length) return 0;
  const sorted = [...closed].sort((a, b) => Math.abs(contourArea(b.points)) - Math.abs(contourArea(a.points)));
  return sorted.reduce((sum, contour, index) => {
    const area = Math.abs(contourArea(contour.points));
    return index === 0 ? sum + area : sum - area;
  }, 0);
}
