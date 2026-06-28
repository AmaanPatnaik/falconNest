import { formatNumber, transformContours } from "../geometry/geometry.js";

export function exportSheetsDxf(state) {
  const sheets = state.metrics.sheets || 0;
  for (let sheetIndex = 0; sheetIndex < sheets; sheetIndex += 1) {
    const dxf = buildSheetDxf(state, sheetIndex);
    saveText(`falconnest-sheet-${sheetIndex + 1}.dxf`, dxf, "application/dxf");
  }
}

export function buildSheetDxf(state, sheetIndex) {
  const unitsCode = state.parts.find((part) => part.unitsCode)?.unitsCode || (state.settings.displayUnits === "mm" ? 4 : 1);
  const lines = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$ACADVER",
    "1",
    "AC1009",
    "9",
    "$INSUNITS",
    "70",
    String(unitsCode),
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "ENTITIES",
  ];

  addLine(lines, 0, 0, state.settings.sheetWidth, 0, "SHEET");
  addLine(lines, state.settings.sheetWidth, 0, state.settings.sheetWidth, state.settings.sheetHeight, "SHEET");
  addLine(lines, state.settings.sheetWidth, state.settings.sheetHeight, 0, state.settings.sheetHeight, "SHEET");
  addLine(lines, 0, state.settings.sheetHeight, 0, 0, "SHEET");

  for (const placement of state.placements.filter((item) => item.sheetIndex === sheetIndex)) {
    const contours = transformContours(placement.part.contours, placement);
    contours.forEach((contour) => addContour(lines, contour));
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return `${lines.join("\n")}\n`;
}

function addContour(lines, contour) {
  if (contour.type === "line" && contour.points.length === 2) {
    addLine(lines, contour.points[0].x, contour.points[0].y, contour.points[1].x, contour.points[1].y, "PARTS");
    return;
  }
  if (contour.type === "circle" && contour.center && contour.radius) {
    lines.push("0", "CIRCLE", "8", "PARTS", "10", formatNumber(contour.center.x), "20", formatNumber(contour.center.y), "40", formatNumber(contour.radius));
    return;
  }
  if (contour.type === "arc" && contour.center && contour.radius) {
    lines.push(
      "0",
      "ARC",
      "8",
      "PARTS",
      "10",
      formatNumber(contour.center.x),
      "20",
      formatNumber(contour.center.y),
      "40",
      formatNumber(contour.radius),
      "50",
      formatNumber(((contour.startAngle || 0) + 360) % 360),
      "51",
      formatNumber(((contour.endAngle || 0) + 360) % 360)
    );
    return;
  }
  const points = contour.cadPoints || contour.points;
  lines.push("0", "LWPOLYLINE", "8", "PARTS", "90", String(points.length), "70", contour.closed ? "1" : "0");
  points.forEach((point) => {
    lines.push("10", formatNumber(point.x), "20", formatNumber(point.y));
    if (point.bulge) lines.push("42", formatNumber(point.bulge));
  });
}

function addLine(lines, x1, y1, x2, y2, layer) {
  lines.push("0", "LINE", "8", layer, "10", formatNumber(x1), "20", formatNumber(y1), "11", formatNumber(x2), "21", formatNumber(y2));
}

function saveText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
