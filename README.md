# FalconNest

FalconNest is a production-oriented, browser-only 2D nesting application for CNC routers, laser cutters, plasma cutters, and waterjets. It is a completely static web app: no backend, database, API keys, accounts, or cloud conversion services.

## Local Development

```bash
npm install
npm run dev
```

The dev server opens the static app from `docs/` at `http://localhost:4173`.

## Build

```bash
npm run build
npm run test:static
```

`npm run build` copies the deployable static site to `dist/`. GitHub Pages can also serve directly from `docs/`.

## GitHub Pages

In repository settings, enable GitHub Pages with:

- Source: `Deploy from a branch`
- Branch: your default branch
- Folder: `/docs`

## Supported DXF Import

- `LINE`
- `LWPOLYLINE`
- `POLYLINE`
- `CIRCLE`
- `ARC`

The importer preserves original dimensions and `$INSUNITS` where present. It detects closed contours, warns about open contours, self-intersections, and duplicate entities, removes duplicate points, and keeps exact CAD entities for display/export. Curve approximation is used only for nesting math and is controlled by the Curve Tolerance setting.

## Export

FalconNest exports one DXF per nested sheet. Exported DXFs preserve units, rotations, nested positions, sheet outlines, and supported CAD geometry. `CIRCLE`, `ARC`, and `LWPOLYLINE` bulge values are preserved for imported geometry.

## Nesting Algorithm

The current engine is a deterministic bottom-left-fill polygon placer:

- Builds polygonal contours from DXF entities.
- Generates allowed rotations evenly across 360 degrees from the Part Rotations setting.
- Checks sheet boundaries before placement.
- Prevents overlaps with segment intersection and point-in-polygon tests.
- Uses bounding boxes only as a broad-phase filter, then checks actual polygon collision so triangular and concave parts can interlock when geometry allows.
- Enforces spacing with segment-to-segment distance checks.
- Automatically creates additional sheets.
- Scores candidate placements differently for Gravity, Bounding Box, and Squeeze modes.

This is a real polygon collision-based nesting strategy, but it is not yet a full no-fit-polygon or genetic optimizer.

## Known Limitations

- Internal holes are preserved and displayed, but parts are not nested inside holes.
- This is not yet a no-fit-polygon optimizer, so some highly interlocking layouts may still need a denser candidate search or manual adjustment.
- Manual drag/rotate does not currently re-run collision repair automatically.
- Very large DXF files may require further worker-based optimization for best responsiveness.

## License

MIT. See [`LICENSE`](LICENSE).
