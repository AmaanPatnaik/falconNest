export const EPSILON = 1e-7;

export function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function formatNumber(value) {
  return String(Number(round(value, 6).toFixed(6)));
}

export function clonePoint(point) {
  return { x: point.x, y: point.y, bulge: point.bulge };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function rotatePoint(point, angleDeg, origin = { x: 0, y: 0 }) {
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  return {
    ...point,
    x: x * cos - y * sin + origin.x,
    y: x * sin + y * cos + origin.y,
  };
}

export function translatePoint(point, dx, dy) {
  return { ...point, x: point.x + dx, y: point.y + dy };
}

export function contourArea(points) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function boundsOfPoints(points) {
  if (!points.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function boundsOfContours(contours) {
  return boundsOfPoints(contours.flatMap((contour) => contour.points));
}

export function normalizeContours(contours) {
  const bounds = boundsOfContours(contours);
  return contours.map((contour) => ({
    ...contour,
    points: contour.points.map((point) => translatePoint(point, -bounds.minX, -bounds.minY)),
    cadPoints: contour.cadPoints?.map((point) => translatePoint(point, -bounds.minX, -bounds.minY)),
    center: contour.center ? translatePoint(contour.center, -bounds.minX, -bounds.minY) : undefined,
  }));
}

export function transformContours(contours, transform) {
  const angle = transform.rotation || 0;
  const dx = transform.x || 0;
  const dy = transform.y || 0;
  const rotated = contours.map((contour) => ({
    ...contour,
    points: contour.points.map((point) => rotatePoint(point, angle)),
    cadPoints: contour.cadPoints?.map((point) => rotatePoint(point, angle)),
    center: contour.center ? rotatePoint(contour.center, angle) : undefined,
    startAngle: contour.startAngle === undefined ? undefined : (contour.startAngle + angle + 360) % 360,
    endAngle: contour.endAngle === undefined ? undefined : (contour.endAngle + angle + 360) % 360,
  }));
  const bounds = boundsOfContours(rotated);
  return rotated.map((contour) => ({
    ...contour,
    points: contour.points.map((point) => translatePoint(point, dx - bounds.minX, dy - bounds.minY)),
    cadPoints: contour.cadPoints?.map((point) => translatePoint(point, dx - bounds.minX, dy - bounds.minY)),
    center: contour.center ? translatePoint(contour.center, dx - bounds.minX, dy - bounds.minY) : undefined,
  }));
}

export function transformedBounds(contours, rotation) {
  return boundsOfContours(transformContours(contours, { rotation, x: 0, y: 0 }));
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y + EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnPolygonBoundary(point, polygon) {
  for (let i = 0; i < polygon.length; i += 1) {
    if (onSegment(polygon[i], point, polygon[(i + 1) % polygon.length])) return true;
  }
  return false;
}

function pointInPolygonStrict(point, polygon) {
  return !pointOnPolygonBoundary(point, polygon) && pointInPolygon(point, polygon);
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < EPSILON) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return (
    Math.abs((b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)) < EPSILON &&
    b.x <= Math.max(a.x, c.x) + EPSILON &&
    b.x + EPSILON >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) + EPSILON &&
    b.y + EPSILON >= Math.min(a.y, c.y)
  );
}

export function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

function segmentsProperlyIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

export function contourSegments(contour) {
  const segments = [];
  const limit = contour.closed ? contour.points.length : contour.points.length - 1;
  for (let i = 0; i < limit; i += 1) {
    segments.push([contour.points[i], contour.points[(i + 1) % contour.points.length]]);
  }
  return segments;
}

export function contoursIntersect(a, b) {
  const aSegments = contourSegments(a);
  const bSegments = contourSegments(b);
  for (const [a1, a2] of aSegments) {
    for (const [b1, b2] of bSegments) {
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return true;
    }
  }
  if (a.closed && b.closed && a.points[0] && pointInPolygonStrict(a.points[0], b.points)) return true;
  if (a.closed && b.closed && b.points[0] && pointInPolygonStrict(b.points[0], a.points)) return true;
  if (a.closed && b.closed && pointInPolygonStrict(interiorSamplePoint(a.points), b.points)) return true;
  if (a.closed && b.closed && pointInPolygonStrict(interiorSamplePoint(b.points), a.points)) return true;
  return false;
}

function interiorSamplePoint(points) {
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );
  return { x: total.x / points.length, y: total.y / points.length };
}

export function polygonSelfIntersects(contour) {
  const segments = contourSegments(contour);
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === segments.length - 1) continue;
      if (segmentsIntersect(segments[i][0], segments[i][1], segments[j][0], segments[j][1])) return true;
    }
  }
  return false;
}

export function contoursCollide(aContours, bContours) {
  const aSolids = aContours.filter((contour) => contour.closed && Math.abs(contourArea(contour.points)) > EPSILON);
  const bSolids = bContours.filter((contour) => contour.closed && Math.abs(contourArea(contour.points)) > EPSILON);
  for (const a of aSolids) {
    for (const b of bSolids) {
      if (contoursIntersect(a, b)) return true;
    }
  }
  return false;
}

export function contoursTooClose(aContours, bContours, spacing) {
  if (spacing <= EPSILON) return false;
  const aSegments = aContours.flatMap(contourSegments);
  const bSegments = bContours.flatMap(contourSegments);
  for (const [a1, a2] of aSegments) {
    for (const [b1, b2] of bSegments) {
      if (segmentDistance(a1, a2, b1, b2) < spacing - EPSILON) return true;
    }
  }
  return false;
}

function segmentDistance(a, b, c, d) {
  if (segmentsProperlyIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b)
  );
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

export function approximateArc(cx, cy, radius, startDeg, endDeg, tolerance) {
  let sweep = endDeg - startDeg;
  if (sweep <= 0) sweep += 360;
  const safeTolerance = Math.max(tolerance, radius / 10000, EPSILON);
  const angleStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - safeTolerance / radius)));
  const segments = Math.max(6, Math.ceil(((sweep * Math.PI) / 180) / angleStep));
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = ((startDeg + (sweep * i) / segments) * Math.PI) / 180;
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return points;
}

export function hasDuplicateContour(contour, seen) {
  const key = contour.points.map((point) => `${round(point.x, 5)},${round(point.y, 5)}`).join("|");
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}

export function removeDuplicatePoints(points) {
  const cleaned = [];
  for (const point of points) {
    const previous = cleaned[cleaned.length - 1];
    if (!previous || distance(previous, point) > EPSILON) cleaned.push(clonePoint(point));
  }
  if (cleaned.length > 2 && distance(cleaned[0], cleaned[cleaned.length - 1]) < EPSILON) cleaned.pop();
  return cleaned;
}
