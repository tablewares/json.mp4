// src/agent/introspect.js
//
// Read-only introspection over the asset/transition registries and the
// anchor system, shaped for an LLM agent driving the pipeline via CLI
// commands. An agent should never need to open a manifest.json file by hand
// to discover what keys an asset or transition accepts — everything here is
// derived from the SAME manifest.json files src/registry/assetRegistry.js
// already scans, so this can never drift from what render actually supports.

import { loadAssetRegistry, loadTransitionRegistry } from "../registry/assetRegistry.js";
import { ANCHOR_POSITIONS } from "../templating/anchor.js";

// Boundary/range constraints the agent needs to author values that survive
// validate. AJV's per-asset content/style schemas carry these on the same
// def object as type/enum; without surfacing them the CLI hides them and the
// agent learns of out-of-range values only after validate fails.
function fieldConstraints(def) {
  const out = {};
  if (def.minItems !== undefined) out.minItems = def.minItems;
  if (def.maxItems !== undefined) out.maxItems = def.maxItems;
  if (def.minimum !== undefined) out.minimum = def.minimum;
  if (def.maximum !== undefined) out.maximum = def.maximum;
  if (def.pattern !== undefined) out.pattern = def.pattern;
  return out;
}

function toContentEntry([key, def]) {
  return {
    key,
    type: def.type ?? (def.oneOf ? "oneOf" : def.enum ? "enum" : "any"),
    enum: def.enum,
    description: def.description,
    itemsDescription: def.items?.description,
    ...fieldConstraints(def),
  };
}

function summarizeContentSchema(schema) {
  if (!schema || schema.type !== "object") return { required: [], optional: [] };
  const required = new Set(schema.required ?? []);
  const props = schema.properties ?? {};
  return {
    required: Object.entries(props).filter(([k]) => required.has(k)).map(toContentEntry),
    optional: Object.entries(props).filter(([k]) => !required.has(k)).map(toContentEntry),
  };
}

function summarizeStyleSchema(schema, defaultStyle = {}) {
  if (!schema || schema.type !== "object") return [];
  const props = schema.properties ?? {};
  return Object.entries(props).map(([key, def]) => ({
    key,
    type: def.type ?? (def.enum ? "enum" : "any"),
    enum: def.enum,
    description: def.description,
    default: defaultStyle[key],
    ...fieldConstraints(def),
  }));
}

/** Cheap one-line-per-type summary. Always safe to dump in full. */
export function listAssetTypes() {
  const registry = loadAssetRegistry();
  return Object.entries(registry).map(([assetType, entry]) => ({
    assetType,
    description: entry.manifest.description,
    defaultSize: entry.manifest.defaultSize,
  }));
}

export function describeAsset(assetType) {
  const registry = loadAssetRegistry();
  const entry = registry[assetType];
  if (!entry) {
    throw new Error(`Unknown assetType "${assetType}". Available: ${Object.keys(registry).join(", ")}`);
  }
  const m = entry.manifest;
  return {
    assetType,
    description: m.description,
    defaultSize: m.defaultSize,
    defaultStyle: m.defaultStyle ?? {},
    content: summarizeContentSchema(m.contentOverrideSchema),
    style: summarizeStyleSchema(m.styleOverrideSchema, m.defaultStyle),
  };
}

export function listTransitionTypes() {
  const registry = loadTransitionRegistry();
  return Object.entries(registry).map(([transitionType, entry]) => ({
    transitionType,
    description: entry.manifest.description,
    defaultDurationInFrames: entry.manifest.defaultDurationInFrames,
  }));
}

export function describeTransition(transitionType) {
  const registry = loadTransitionRegistry();
  const entry = registry[transitionType];
  if (!entry) {
    throw new Error(`Unknown transitionType "${transitionType}". Available: ${Object.keys(registry).join(", ")}`);
  }
  const m = entry.manifest;
  const params = Object.entries(m.params ?? {}).map(([key, def]) => ({
    key,
    type: def.type,
    default: def.default,
    enum: def.enum,
    description: def.description,
    ...fieldConstraints(def),
  }));
  return {
    transitionType,
    description: m.description,
    defaultDurationInFrames: m.defaultDurationInFrames,
    consumes: m.consumes ?? {},
    params,
  };
}

export function listAnchorPositions() {
  return ANCHOR_POSITIONS;
}

const ASSET_COLLECTIONS = {
  youtubeSearch: {
    collectionType: "youtubeSearch",
    label: "YouTube search",
    category: "audio",
    description:
      "Find candidate YouTube tracks or SFX by keyword before downloading them into public/audio/sources.",
    destination: "public/audio/sources/",
    prerequisites: ["yt-dlp", "python3"],
    command: "yt-dlp --flat-playlist --dump-json 'ytsearchN:<query>'",
    outputFields: ["id", "title", "duration", "url", "channel"],
    docs: ["docs/skills/assetlibrary/01-youtube-search.md"],
    example: "yt-dlp --flat-playlist --dump-json 'ytsearch5:free whoosh transition sound effect'",
  },
  ytDlpDownload: {
    collectionType: "ytDlpDownload",
    label: "yt-dlp download",
    category: "audio",
    description:
      "Download a chosen YouTube source into public/audio/sources and keep the final referenced file in public/audio.",
    destination: "public/audio/ and public/audio/sources/",
    prerequisites: ["yt-dlp", "ffmpeg", "python3"],
    command: "yt-dlp -x --audio-format mp3 --audio-quality 0 -o '%(id)s - %(title).70s.%(ext)s' '<youtube-url>'",
    outputFields: ["path", "format", "duration", "size", "sourceUrl"],
    docs: ["docs/skills/assetlibrary/02-yt-dlp-download.md"],
    example: "yt-dlp -x --audio-format mp3 --audio-quality 0 -o '%(id)s - %(title).70s.%(ext)s' 'https://www.youtube.com/watch?v=<ID>'",
  },
  sfxSplit: {
    collectionType: "sfxSplit",
    label: "SFX pack slicing",
    category: "audio",
    description:
      "Split one pack video into one-hit clips using silence detection and write each clip to public/audio/split.",
    destination: "public/audio/split/",
    prerequisites: ["ffmpeg", "python3"],
    command: "ffmpeg -nostdin -hide_banner -i '<source>.mp3' -af 'silencedetect=n=-30dB:d=0.18' -f null -",
    outputFields: ["clipPath", "startSeconds", "endSeconds", "durationSeconds"],
    docs: ["docs/skills/assetlibrary/03-sfx-from-single-source.md"],
    example: "ffmpeg -nostdin -hide_banner -i 'public/audio/sources/source.mp3' -af 'silencedetect=n=-30dB:d=0.18' -f null -",
  },
  imageSearch: {
    collectionType: "imageSearch",
    label: "Yandex image search",
    category: "image",
    description:
      "Search for still-image sources through the browser-backed Yandex Images adapter, then download to public/assets.",
    destination: "public/assets/",
    prerequisites: ["opencli", "curl"],
    command: "opencli yandeximages search '<query>' --limit 10 -f json",
    outputFields: ["image_url", "thumb_url", "title", "width", "height", "source_url"],
    docs: ["docs/skills/assetlibrary/04-images-opencli.md", "docs/skills/assetlibrary/images/search.js"],
    example: "opencli yandeximages search 'abstract concrete texture' --limit 10 -f json",
  },
  manifestWiring: {
    collectionType: "manifestWiring",
    label: "Manifest wiring",
    category: "manifest",
    description:
      "Validate the path contract and write finalized files from public/audio or public/assets into scene manifests.",
    destination: "Scene manifest paths relative to public/",
    prerequisites: ["None beyond final public files"],
    command: "scene.assets[].src = 'assets/*.png' or scene.transitionOut.effects[].path = 'audio/*.mp3'",
    outputFields: ["path", "assetType", "kind", "anchor", "volume"],
    docs: ["docs/skills/assetlibrary/05-manifest-wiring.md"],
    example: '{ "assetType": "ImageReveal", "src": "assets/hero.png" }',
  },
};

function canonicalCollectionKey(name) {
  if (!name) return null;
  const normalized = String(name).trim().toLowerCase();
  const directMatch = Object.keys(ASSET_COLLECTIONS).find((key) => key.toLowerCase() === normalized);
  if (directMatch) return directMatch;

  const aliases = {
    youtube: "youtubeSearch",
    youtubesearch: "youtubeSearch",
    youtubes: "youtubeSearch",
    ytdlp: "ytDlpDownload",
    ytdlpdownload: "ytDlpDownload",
    download: "ytDlpDownload",
    sfx: "sfxSplit",
    sfxsplit: "sfxSplit",
    split: "sfxSplit",
    image: "imageSearch",
    images: "imageSearch",
    yandex: "imageSearch",
    yandeximages: "imageSearch",
    manifest: "manifestWiring",
    wiring: "manifestWiring",
    library: "youtubeSearch",
  };

  return aliases[normalized] ?? null;
}

export function listAssetCollections() {
  return Object.values(ASSET_COLLECTIONS).map(({ collectionType, label, category, description, destination, prerequisites, docs }) => ({
    collectionType,
    label,
    category,
    description,
    destination,
    prerequisites,
    docs,
  }));
}

export function describeAssetCollection(collectionName) {
  const key = canonicalCollectionKey(collectionName);
  const entry = ASSET_COLLECTIONS[key];
  if (!entry) {
    throw new Error(
      `Unknown asset collection "${collectionName}". Available: ${Object.keys(ASSET_COLLECTIONS).join(", ")}`
    );
  }
  return {
    ...entry,
    collectionType: entry.collectionType,
    command: entry.command,
    output: {
      fields: entry.outputFields,
    },
  };
}

/** Static reference for scene/asset/effect envelope fields that aren't tied
 * to any one asset/transition manifest. Lets the agent skip ever reading
 * scene.schema.json / manifest.schema.json by hand. */
export function describeSceneEnvelope() {
  return {
    scene: {
      id: "string, unique within the project",
      narrationRef: "optional: id into manifest.narration.entries — drives this scene's duration via TTS",
      background: "color token (e.g. 'shade1'), a literal #RRGGBB hex string, or an object { color?, texture?, blendMode?, opacity? } — texture pulls a textures.* token overlaid above the color, behind all assets",
      camera: "optional: { start, end, zoomStartPercent, zoomEndPercent, zoomPercent } — start/end are anchor specs",
      transitionOut: "optional: { type, durationInFrames?, params?, effects? } — omit for a hard cut",
      assets: "array of asset specs, see 'asset' below (managed via add-asset, not set directly)",
    },
    asset: {
      id: "optional (auto-generated if omitted), unique within the scene",
      assetType: "must be a registered asset type — see the 'assets' command",
      anchor: "{ position, offsetXPercent?, offsetYPercent? } — position is one of the 'anchors' command's output",
      contentOverride: "asset-specific — see `asset <type>` command's 'content' field",
      styleOverride: "asset-specific — see `asset <type>` command's 'style' field; width/height also settable here",
      enterAt: "fraction 0-1 of the scene's duration (default 0)",
      exitAt: "fraction 0-1 of the scene's duration (default 1)",
      z: "number, stacking order resolved at runtime. Lower z paints first (further from viewer), higher z last (on top). Default 0. Stable within a z value — authored order is preserved.",
      motion: "optional: { in?, out?, rotateDeg?, rotate? } — in: 'fade'|'fadeUp'|'fadeDown'|'fadeLeft'|'fadeRight' (or object with alias/distancePx/durationInFrames/rotateFromDeg); out: 'fadeOut'|'fadeOutUp'|'fadeOutDown'|'fadeOutLeft'|'fadeOutRight' (same object shape); rotateDeg: static rotation held for the whole on-screen duration; rotate: animated phase { toDeg (required), fromDeg? (defaults to rotateDeg or 0), durationInFrames? (default 18), delayFrames? (default 0), startAt?: 'afterIn'|'withIn'|'atFrame' (default 'afterIn'), atFrame? (required when startAt is 'atFrame'), easing?: 'linear'|'easeIn'|'easeOut'|'easeInOut' (default 'easeInOut') } — begins after the entrance resolves by default; see scripts/curate/asset/motion.md for full composition rules",
    },
    transitionEffect: {
      id: "optional",
      kind: "'sfx' or 'visual'",
      offsetPercent: "0 = scene's visible end frame; negative = earlier; positive = into the transition overlap",
      sfx: "additional keys: { path, volume?, durationInFrames? }",
      visual: "additional keys: { assetType, anchor?, contentOverride?, styleOverride?, durationInFrames? } — resolved like a normal asset",
    },
  };
}
