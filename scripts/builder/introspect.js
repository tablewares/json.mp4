// src/agent/introspect.js
//
// Read-only introspection over the asset/transition registries and the
// anchor system, shaped for an LLM agent driving the pipeline via CLI
// commands. An agent should never need to open a manifest.json file by hand
// to discover what keys an asset or transition accepts — everything here is
// derived from the SAME manifest.json files src/registry/assetRegistry.js
// already scans, so this can never drift from what render actually supports.

import { loadAssetRegistry, loadTransitionRegistry } from "../../src/registry/assetRegistry.js";
import { ANCHOR_POSITIONS } from "../../src/templating/anchor.js";

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
    command: "scene.assets[].src = 'assets/*.png' or scene.effects[].path = 'audio/*.mp3' (effects are scene-level, not transitionOut — see effects.schema.json)",
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
    commandNote: "Angle-bracket tokens in `command` (e.g. <query>, <youtube-url>, <source>) are placeholders for you to substitute — they are not literal shell syntax and running the command verbatim will fail.",
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
      narrationRef: "optional: id into manifest.narration.entries — drives this scene's duration via TTS (or, for a `kind: 'silence'` entry, via that entry's own durationSeconds — see the 'manifest' command)",
      background: "color token (e.g. 'shade1'), a literal #RRGGBB hex string, or an object { color?, texture?, blendMode?, opacity? } — texture pulls a textures.* token overlaid above the color, behind all assets",
      camera: "optional: { start, end, zoomStartPercent, zoomEndPercent, zoomPercent } — start/end are anchor specs",
      transitionOut: "optional: { type, durationInFrames?, params? } — type MUST be one of the 'transitions' command's output; omit the whole field for a hard cut (effects live on scene.effects, not here — see below)",
      effects: "optional: detached scene-level effects array (effects.schema.json). Each entry { id, kind, frame, ... } anchors to an EXACT scene-local frame (not a percent). Append via add-effect / inject-effects; resolve via resolveSceneEffects.",
      assets: "array of asset specs, see 'asset' below (managed via add-asset, not set directly)",
    },
    asset: {
      id: "optional (auto-generated if omitted), unique within the scene",
      assetType: "must be a registered asset type — see the 'assets' command",
      anchor: "{ position, offsetXPercent?, offsetYPercent? } — position is one of the 'anchors' command's output",
      contentOverride: "asset-specific — see `asset <type>` command's 'content' field. NOTE: for any asset whose content renders as a <video> (ImageReveal auto-detects .mp4/.webm/.mov/.m4v by extension), the JSX component ALSO reads contentOverride.muted (default true) and contentOverride.volume (default 1) even though neither key is declared in that asset's contentOverrideSchema — the schema's `additionalProperties` is unset so they pass validate silently. A scene with NO narration relying on the video's own audio (e.g. a found-footage/news clip) MUST set muted: false or the render is silent.",
      styleOverride: "asset-specific — see `asset <type>` command's 'style' field; width/height also settable here",
      enterAt: "fraction 0-1 of the scene's duration (default 0), OR a timing anchor object: { relativeToAsset, edge?: 'enter'|'exit', offsetFrames? } to fire relative to an EARLIER asset's edge, { relativeToWord, edge?, offsetFrames? } to fire at a specific spoken word or phrase in the SCENE's own narration (relativeToWord: a word index, exact word text, or array of words/indices for a phrase — no asset needs to display that text), { relativeToAsset, relativeToWord, edge?, offsetFrames? } to read word timing from a specific asset's own resolved words instead, { relativeToCameraAction, offsetFrames? } to fire relative to a camera action, or { offsetPercent } for scene-end-relative percent — same shape as transitionEffect timing anchors",
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

/** Static reference for manifest.json's top-level fields that live OUTSIDE
 * any one scene — narration (including the silence-block variant),
 * audioOverlay, music. Companion to describeSceneEnvelope(); together they
 * cover every authored key without reading manifest.schema.json or
 * scene.schema.json by hand. */
export function describeManifestEnvelope() {
  return {
    projectId: "string, unique — becomes the studio/manifest/<projectId>/ directory name",
    config: "relative path to config.json ({ fps, width, height, defaultSceneDurationInFrames })",
    styles: "relative path to the style/theme JSON (colors, typography, spacing, easing, textures — see style.schema.json)",
    narration: {
      description: "optional. When present, every scene's narrationRef looks up its duration from this block's synthesized/silent timing INSTEAD of config.defaultSceneDurationInFrames.",
      entries: "array, order matters — see 'entries item shapes' below. Every scene.narrationRef must match exactly one entry's id.",
      "entries item shapes": {
        spoken: "{ id, text } — fed to TTS synthesis (external/tts-provider.js -> pocket_tts/kyutai_tts.js on 127.0.0.1:8000). Consecutive spoken entries are synthesized together as ONE audio clip for alignment quality.",
        silence: "{ id, kind: 'silence', durationSeconds } — NO TTS synthesis; occupies a real span of the single composition-wide narration audio track (filled with generated digital silence). Positioned purely by array order relative to its neighboring entries — there is no absolute-timestamp field. A scene whose narrationRef points at a silence entry has NO spoken narration; that scene's own video/audio asset (if any) should set contentOverride.muted: false — see the 'envelope' command's asset.contentOverride note.",
      },
      fullTranscript: "string — the spoken entries' text concatenated in order (silence entries contribute nothing). Must match what was actually synthesized; drives the WhisperX alignment pass. The provider's cache key is a hash of entries+fullTranscript together, so any edit re-synthesizes everything.",
    },
    audioOverlay: "optional array of hand-authored { id, start, end, path, volume? } tracks (seconds, path relative to public/). IGNORED when narration is present — the real synthesized+aligned audio overrides it entirely (see resolve.js). Only meaningful for a no-narration project that still wants a fixed audio track.",
    music: "optional array of { id, path, volume?, start?, end?, loop?, fadeInSeconds?, fadeOutSeconds? } background tracks, layered under narration/audioOverlay at reduced volume (default 0.25). Independent of TTS timing — omit entirely for a music-less project (strict no-op).",
    scenes: "array of { id, path } routing entries, in PLAY ORDER. Managed by add-scene, not hand-edited — see scripts/SKILL.md.",
    physicsPresets: "optional relative path to a JSON file of reusable named physics specs, referenceable from scenes as \"$physics.<path>\".",
  };
}

// -------------------------------------------------------------
// pitfalls — hand-curated, NOT derived from schema/registry
// -------------------------------------------------------------
//
// Everything else in this file is a structural read of a manifest.json
// file the registry already scans, so it can never drift from what render
// actually supports. Pitfalls are the opposite: a manifest can be
// perfectly schema-valid and still silently misbehave (wrong output, not
// a thrown error) because of an interaction between two different modules
// that no single schema file can express. This is deliberately a small,
// hand-maintained list in the same spirit as ASSET_COLLECTIONS above —
// add an entry here the next time an agent (or you) gets bitten by a
// silent-misbehavior trap that discovery didn't warn about.

const PITFALLS = {
  ImageReveal: [
    {
      title: "Video assets default to muted — silent scenes need muted: false",
      detail:
        "contentOverride.muted defaults to true and contentOverride.volume defaults to 1 (read directly by ImageReveal.jsx, NOT declared in contentOverrideSchema — see the 'envelope' command's contentOverride note). Correct for b-roll under narration (silent footage, narration carries the scene); wrong for a scene with NO narration where the clip's own audio is the only sound (e.g. a found-footage/news clip). Symptom: ffmpeg volumedetect reads -91dB (true digital silence) across that scene's window even though the mp4 has a real audio stream.",
      fix: "Set contentOverride.muted: false (and contentOverride.volume if you want it below 1) on any video asset whose audio must be heard.",
    },
    {
      title: "useAsSceneDuration needs contentOverride.src present",
      detail: "Throws \"has contentOverride.useAsSceneDuration: true but no contentOverride.src to probe\" in resolveScene.js if src is missing — easy to lose on a copy-paste from a non-video asset spec.",
      fix: "Always pair useAsSceneDuration: true with a valid contentOverride.src pointing at the video to probe.",
    },
    {
      title: "relativeToWord enterAt is for IMAGES, not videos",
      detail: "Anchoring a video's enterAt to a spoken word works schema-wise but reads oddly in practice — b-roll convention reserves relativeToWord timing for still images; videos should enter with a plain fraction (0-1) or relativeToAsset/relativeToCameraAction.",
      fix: "Use relativeToWord only on ImageReveal assets holding a still image, not a video.",
    },
  ],
  narration: [
    {
      title: "relativeToWord matches the EXACT WhisperX token including punctuation",
      detail: "\"bonds\" will not match if WhisperX transcribed it as \"bonds,\" — the comma is part of the token. Also applies inside a relativeToWord phrase array; every element must exist verbatim or resolve throws.",
      fix: "Read the actual token list from the TTS cache (public/audio/tts_<sha>.json) before authoring relativeToWord, or copy the exact string from a resolve error message's suggestion list.",
    },
    {
      title: "TTS server down makes resolve hang silently, not fail fast",
      detail: "If manifest.narration is present and the Kyutai server (127.0.0.1:8000) isn't running, resolve.js blocks on synthesizeVoice() with no log line until killed.",
      fix: "Check `ss -tlnp | grep :8000` before a narrated resolve. If down, either start it or drop the narration block entirely (scenes then fall back to config.defaultSceneDurationInFrames, no relativeToWord timing, but renderable).",
    },
    {
      title: "A silence entry's durationSeconds only matters for downstream timing sync",
      detail: "It doesn't have to be pixel-exact to the clip that fills it — useAsSceneDuration re-probes the video's real length independently — but it drives where every LATER narration entry's start/end lands in the single composition-wide audio track, so a wrong value drifts every scene after it.",
      fix: "Use the ffprobe-measured duration of the clip filling that scene, not a rounded guess.",
    },
  ],
  transitions: [
    {
      title: "carryAssetId must exist in BOTH the outgoing and incoming scene",
      detail: "pivotZoom and slideContinuity throw at resolve (not validate) if the named asset id is missing from either scene — easy to trip when an id gets renamed in one scene but not the other, or when a carry-using transition is copied onto a scene pair that doesn't actually share the asset.",
      fix: "Confirm the id appears in both scenes' assets[] before authoring a carry transition, or drop the carry (use 'default'/'WhipPan'/'fade' instead) for a hard topic-change cut.",
    },
    {
      title: "Omitting transitionOut.durationInFrames silently zero-pads the scene boundary",
      detail: "resolve.js computes scene-pad as `transitionOut?.durationInFrames ?? 0`, but the transition OVERLAY still renders at the registry's own defaultDurationInFrames — so an authored transitionOut with no explicit duration eats the next scene's first ~18 frames without reserving timeline space for it.",
      fix: "Always pass an explicit durationInFrames when authoring transitionOut by hand (agent-cli's ProjectBuilder backfills this automatically; hand-edited manifests do not get that fallback).",
    },
  ],
};

const PITFALL_KEY_ALIASES = {
  video: "ImageReveal",
  narration: "narration",
  tts: "narration",
  silence: "narration",
  transition: "transitions",
  transitions: "transitions",
};

export function listPitfallTopics() {
  return Object.keys(PITFALLS);
}

/** Curated silent-misbehavior traps for one topic (an assetType, or
 * "narration"/"transitions"). Not derivable from schema/registry — these
 * are interaction bugs between modules that a shape-valid manifest can
 * still trip. Call with no args to list available topics. */
export function describePitfalls(topic) {
  if (!topic) {
    return {
      topics: listPitfallTopics(),
      note: "call with one of the topics above, e.g. `pitfalls ImageReveal`",
    };
  }
  const key = PITFALLS[topic] ? topic : PITFALL_KEY_ALIASES[topic.toLowerCase()];
  const entries = key && PITFALLS[key];
  if (!entries) {
    throw new Error(`No curated pitfalls for "${topic}". Available: ${listPitfallTopics().join(", ")}`);
  }
  return { topic: key, pitfalls: entries };
}