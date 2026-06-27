# FalconNest

FalconNest is a browser-only DXF nesting prototype intended for GitHub Pages.
It imports DXF files directly in the browser, places parts on one or more sheets,
rotates parts through the full 360 degree range, and saves SVG or DXF output
without requiring an installer, desktop app, account, or conversion server.

## Static Site

The deployable site lives in [`docs/`](docs/). Enable GitHub Pages with:

- Source: `Deploy from a branch`
- Branch: your default branch
- Folder: `/docs`

You can also open [`docs/index.html`](docs/index.html) locally in a browser.

## Current DXF Support

The static app supports common lightweight DXF geometry:

- `LINE`
- `LWPOLYLINE`
- `CIRCLE`
- `ARC`

`LWPOLYLINE` bulge values are preserved when exporting DXF so curved segments in
supported polylines keep their CAD geometry.

The nesting strategy is intentionally simple: parts are packed by bounding box
onto rows with configurable sheet size, spacing, rotation step, units, and
copies per file. Exported DXFs keep the imported `$INSUNITS` setting when it is
present, and supported DXF entities are emitted as DXF geometry rather than a
raster image.

## Repository Notes

The repository has been reduced to the static GitHub Pages app under `docs/`
plus minimal project metadata.

## License

MIT. See [`LICENSE`](LICENSE).
