# scripts/svg — local icon library for SvgImage

`fetch_icon.mjs` pulls brand/UI icons from the `simple-icons` npm package
(installed as a normal dependency — ~3450 SVG marks, fully offline, no API
key, no network call) and writes them into `public/svg/` as standalone
`<svg>` files ready to be referenced from `SvgImage`'s `content.src`
(`studio/assets/SvgImage/SvgImage.jsx`).

Mirrors the `scripts/pexels/fetch_image.mjs` CLI shape: pass one or more
queries, get ranked candidates printed, top match saved.

## Usage

```bash
node scripts/svg/fetch_icon.mjs "github" "youtube" "bitcoin"
node scripts/svg/fetch_icon.mjs --list "git"        # just list candidates, no write
node scripts/svg/fetch_icon.mjs --exact vercel        # only write on an exact slug/title match
```

Each match is written to `public/svg/<slug>.svg` — a self-contained square
SVG (`viewBox 0 0 24 24`) with the icon's official path filled with its
official brand hex. The slug is `simple-icons`' own stable identifier
(lowercase, URL-safe), so `content.src` stays predictable, e.g.
`"svg/github.svg"`.

## Wiring into a scene

```bash
node scripts/cli.js asset create <sceneId> <assetId> \
  '{"assetType":"SvgImage","contentOverride":{"src":"svg/github.svg"},"anchor":{"position":"center"}}'
```

`SvgImage` traces a self-drawing dashed boundary around the icon's real
opaque pixels (not its bounding box) via `useAlphaSilhouette` — see
`studio/assets/SvgImage/README.md` for the full contract and
`styleOverride` boundary knobs.

## Rules
- Only use this library for brand/product/UI logo marks. For stock
  photos/video use `scripts/pexels/`; for people/specific objects use the
  `scripts/agent-cli.mjs collections` workflows (see
  `scripts/curate/solutions/pattern.md`).
- Search is fuzzy by default (title/slug substring match); pass `--exact`
  when you need a guaranteed single result instead of picking `[0]`.
- The full library (`Object.keys(simple-icons)`, ~3453 entries, each with
  `{ title, slug, svg, path, hex, source }`) is available for any other
  script that wants the same source without going through the CLI.
