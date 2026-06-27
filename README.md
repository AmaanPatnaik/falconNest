# FalconNest

FalconNest is a browser-only DXF nesting prototype intended for GitHub Pages.
It imports DXF files directly in the browser, places parts on one or more sheets,
and saves SVG or DXF output without requiring an installer, desktop app, account,
or conversion server.

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

The nesting strategy is intentionally simple: parts are packed by bounding box
onto rows with configurable sheet size, spacing, units, and copies per file.
That keeps the first public version reliable on GitHub Pages while avoiding the
old native/Electron and server-conversion failure points.

## Repository Notes

The repository has been reduced to the static GitHub Pages app under `docs/`
plus minimal project metadata.

## License

MIT. See [`LICENSE`](LICENSE).
