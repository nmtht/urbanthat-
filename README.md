# Urban That

Standalone generative city editor. Draw roads and zones with brushes on a real OSM map fragment and get immediate, visually pleasant 3D feedback — no Rhino, no Unreal, no “generate” button.

**Visual language:** if Apple made City Skylines — casual city feel, professional interface.

## Status

Skeleton (Sprint 0). Empty scene with ground plane + OrbitControls. See [docs/TZ.md](docs/TZ.md) for full specification and MVP plan.

## Stack

| Layer | Choice |
|-------|--------|
| Shell | Electron |
| 3D | Three.js (+ React Three Fiber) |
| Geometry (2D) | Clipper2 WASM |
| OSM | Overpass API + proj4 |
| UI | React overlay |
| State | Command pattern (undo/redo) |

## Requirements

- Node.js 20+
- macOS (primary) or Windows

## Quick start

```bash
npm install
npm run dev          # Vite only (browser)
# or
npm run electron:dev # Electron + Vite (requires electron main build step — see below)
```

> **Note:** Electron main process is TypeScript. For a minimal first run, use `npm run dev` and open the browser. Full Electron wiring will be completed in Sprint 0.

## Project structure

```
urbanthat/
├── electron/          # Main + preload
├── src/
│   ├── domain/        # Zone, RoadEdge, RoadNode, Building, SceneOrigin
│   ├── geometry/      # Graph, link+hub, metrics, massing
│   ├── osm/           # Overpass client, projection, context layer
│   ├── render/        # Three.js scene, layers, materials
│   ├── tools/         # Road brush, zone brush, raycast
│   ├── state/         # Commands, undo/redo, project model
│   └── ui/            # React panels, import dialog
├── docs/
│   └── TZ.md          # Full technical specification
└── package.json
```

## Principles (non-negotiable)

- No dependency on Rhino / RhinoCommon
- No bridge to Unreal — visualization is in-process
- 3D from day one
- OSM base layer from day one
- Brushes only for roads and zones; buildings are generative only
- Immediate visual feedback while drawing

## License

UNLICENSED (private) for now.
