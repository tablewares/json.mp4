#!/usr/bin/env node
// scripts/build-index.mjs
//
// Generates the repo-root index.html — a static, browsable "what can this
// framework do" reference. Every fact on the page is pulled LIVE from the
// same introspection surfaces the agent CLIs use (scripts/discovery.mjs's
// backing module scripts/builder/introspect.js, scripts/schema-cli.mjs's
// backing module scripts/schema-lib/schemaIntrospect.js, and the alias/theme
// registries) — nothing here is a second hand-maintained copy of the asset
// list, schema shapes, or alias catalogue. Re-run this after adding an
// asset, transition, alias, theme, or schema field so index.html stays
// accurate:
//
//   node scripts/build-index.mjs
//
// Output: index.html at the repo root (gitignored is NOT assumed — check
// before committing if that matters for this repo's conventions).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  listAssetTypes,
  describeAsset,
  listTransitionTypes,
  describeTransition,
  listAnchorPositions,
  listAssetCollections,
} from "./builder/introspect.js";

import {
  listAliases,
  listAliasCategories,
} from "../src/registry/aliasRegistry.js";
import { loadAliasLibrary } from "../src/registry/aliasLibrary.js";
import { listThemes } from "../src/registry/themeLibrary.js";

import {
  listSchemas,
  describeDefinition,
} from "./schema-lib/schemaIntrospect.mjs";

loadAliasLibrary();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Gather live data
// ---------------------------------------------------------------------------

const assets = listAssetTypes().map((a) => describeAsset(a.assetType));
const transitions = listTransitionTypes().map((t) => describeTransition(t.transitionType));
const anchorPositions = listAnchorPositions();
const collections = listAssetCollections();
const aliasCategories = listAliasCategories();
const aliasesByCategory = Object.fromEntries(
  aliasCategories.map((c) => [c, listAliases(c)[c] ?? []]),
);
const themes = listThemes();
const schemas = listSchemas();

const motionSpec = describeDefinition("scene.schema.json", "motionSpec");
const cameraSpec = describeDefinition("camera.schema.json", "cameraSpec");
const cameraAction = describeDefinition("camera.schema.json", "cameraAction");
const cameraAnchor = describeDefinition("camera.schema.json", "cameraAnchor");
const timingAnchor = describeDefinition("shared.schema.json", "timingAnchor");
const aliasRef = describeDefinition("shared.schema.json", "aliasRef");
const scenePhysicsSpec = describeDefinition("physics.schema.json", "scenePhysicsSpec");
const assetPhysicsSpec = describeDefinition("physics.schema.json", "assetPhysicsSpec");
const sfxEffect = describeDefinition("effects.schema.json", "sfxEffect");
const visualEffect = describeDefinition("effects.schema.json", "visualEffect");
const backgroundSpec = describeDefinition("shared.schema.json", "backgroundSpec");

// ---------------------------------------------------------------------------
// Tiny HTML helpers (no template deps)
// ---------------------------------------------------------------------------

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function code(s) {
  return `<code>${esc(s)}</code>`;
}

/** Renders a schema-node's `properties` map (as produced by describeNode)
 *  as a compact definition list: name (required?) : type/enum — description. */
function propsList(node) {
  if (!node?.properties) return "";
  return `<dl class="props">${Object.entries(node.properties)
    .map(([name, p]) => {
      const req = p.required ? '<span class="req">required</span>' : '<span class="opt">optional</span>';
      const kind = fieldKind(p);
      return `<dt>${code(name)} ${req}</dt><dd><span class="kind">${esc(kind)}</span>${
        p.description ? ` — ${esc(p.description)}` : ""
      }</dd>`;
    })
    .join("")}</dl>`;
}

function fieldKind(node) {
  if (!node) return "";
  if (node.enum) return `enum(${node.enum.map((e) => JSON.stringify(e)).join(" | ")})`;
  if (node.oneOf) return node.oneOf.map(fieldKind).filter(Boolean).join(" | ");
  if (node.type === "array") return `${fieldKind(node.items)}[]`;
  if (node.properties) return "object { " + Object.keys(node.properties).join(", ") + " }";
  return node.type ?? "any";
}

function pill(text) {
  return `<span class="pill">${esc(text)}</span>`;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildAssetsSection() {
  const cards = assets
    .map(
      (a) => `
    <article class="card" data-search="${esc((a.assetType + " " + a.description).toLowerCase())}">
      <h3>${esc(a.assetType)}</h3>
      <p>${esc(a.description)}</p>
      <div class="meta">
        ${pill(`${a.defaultSize?.width}×${a.defaultSize?.height}`)}
        ${a.contentOverrideSchema ? pill("content: " + Object.keys(a.contentOverrideSchema.properties ?? {}).join(", ")) : ""}
      </div>
    </article>`,
    )
    .join("\n");
  return `
  <section id="assets">
    <h2>Assets <span class="count">${assets.length}</span></h2>
    <p class="lede">Every registered <code>assetType</code> under <code>studio/assets/</code> and <code>studio/graphics/</code>. Discover live: <code>node scripts/discovery.mjs assets</code> / <code>asset &lt;type&gt;</code>.</p>
    <div class="grid">${cards}</div>
  </section>`;
}

function buildTransitionsSection() {
  const cards = transitions
    .map(
      (t) => `
    <article class="card" data-search="${esc((t.transitionType + " " + t.description).toLowerCase())}">
      <h3>${esc(t.transitionType)}</h3>
      <p>${esc(t.description)}</p>
      <div class="meta">${pill(`${t.defaultDurationInFrames} frames default`)}</div>
    </article>`,
    )
    .join("\n");
  return `
  <section id="transitions">
    <h2>Transitions <span class="count">${transitions.length}</span></h2>
    <p class="lede">Registered <code>transitionOut.type</code> values. <code>params.carryAssetId</code>/<code>carryAssetIds</code> carry a shared asset id across the cut (must exist in both scenes). Discover live: <code>node scripts/discovery.mjs transitions</code> / <code>transition &lt;type&gt;</code>.</p>
    <div class="grid">${cards}</div>
  </section>`;
}

function buildPatternSection() {
  return `
  <section id="pattern">
    <h2>The pattern</h2>
    <p class="lede">Every authorable node in <code>src/pipelines/pipeline1-validate/schema/</code> follows one contract. See <code>CLAUDE.md</code> for the canonical writeup.</p>
    <div class="grid three">
      <article class="card">
        <h3>1. Everything has an id</h3>
        <p><code>scene.assets[].id</code> is <strong>required</strong>. Anything referenceable — <code>relativeToAsset</code>, <code>anchor.followAssetId</code>, <code>transitionOut.params.carryAssetId(s)</code>, physics <code>towardAssetId</code>/<code>targetAssetId</code>/<code>carryFromScene.assetId</code> — targets a stable id.</p>
      </article>
      <article class="card">
        <h3>2. Everything can be relative</h3>
        <p>Spatial: named corner + signed % nudge (<code>ANCHOR_ALIGN</code>), or <code>followAssetId</code> + <code>anchorEdge</code> to anchor off another asset's box. One shared resolver: <code>resolveAnchorPoint</code> (<code>src/templating/anchor.js</code>) — used by both asset anchors and camera anchors.</p>
      </article>
      <article class="card">
        <h3>3. Everything times the same way</h3>
        <p>One <code>timingAnchor</code> vocabulary (<code>shared.schema.json</code>): <code>relativeToAsset</code>, <code>relativeToCameraAction</code>, <code>relativeToWord</code>, <code>offsetPercent</code>. Resolved by one function, <code>resolveTimingAnchor</code>, from asset <code>enterAt</code>/<code>exitAt</code>, scene <code>effects[]</code>, and camera <code>actions[].at</code>.</p>
      </article>
    </div>
  </section>`;
}

function buildMotionSection() {
  return `
  <section id="motion">
    <h2>Motion</h2>
    <p class="lede">Per-asset entrance/exit/rotation, authored on <code>asset.motion</code> (<code>scene.schema.json#/definitions/motionSpec</code>). Resolved by <code>src/motion/motion.js</code>.</p>
    <div class="grid two">
      <div class="schema-card">
        <h3>motionSpec</h3>
        ${propsList(motionSpec.oneOf?.[0] ?? motionSpec)}
      </div>
      <div class="schema-card">
        <h3>motion aliases <span class="count">${(aliasesByCategory.motion ?? []).length}</span></h3>
        ${aliasCardList(aliasesByCategory.motion)}
      </div>
    </div>
  </section>`;
}

function buildCameraSection() {
  return `
  <section id="camera">
    <h2>Camera</h2>
    <p class="lede">Scene-level pan/zoom, authored on <code>scene.camera</code>. Multi-leg moves use <code>actions[]</code> keyframes; <code>at</code> accepts a bare fraction <em>or</em> a <code>timingAnchor</code> (word/percent-anchored keyframes, exact-first — see the pattern above). Resolved by <code>src/templating/camera.js</code>.</p>
    <div class="grid two">
      <div class="schema-card">
        <h3>cameraSpec</h3>
        ${propsList(cameraSpec.oneOf?.[0] ?? cameraSpec)}
      </div>
      <div class="schema-card">
        <h3>cameraAction (one keyframe)</h3>
        ${propsList(cameraAction)}
      </div>
      <div class="schema-card">
        <h3>cameraAnchor</h3>
        <p>Two shapes: named <code>position</code> (frame corner) or <code>followAssetId</code> (track another asset's box, via <code>anchorEdge</code>). Same vocabulary as an asset's own <code>anchor</code>.</p>
        <div class="meta">${anchorPositions.map(pill).join("")}</div>
      </div>
      <div class="schema-card">
        <h3>camera aliases <span class="count">${(aliasesByCategory.camera ?? []).length}</span></h3>
        ${aliasCardList(aliasesByCategory.camera)}
      </div>
    </div>
  </section>`;
}

function buildPhysicsSection() {
  return `
  <section id="physics">
    <h2>Physics</h2>
    <p class="lede">Matter.js simulation baked at resolve time into a per-frame track (never runs live at render — see <code>src/physics/resolvePhysics.js</code>). Scene-level gravity/solver via <code>scene.physics</code>; per-asset body via <code>asset.physics</code>.</p>
    <div class="grid two">
      <div class="schema-card">
        <h3>scenePhysicsSpec</h3>
        ${propsList(scenePhysicsSpec)}
      </div>
      <div class="schema-card">
        <h3>assetPhysicsSpec</h3>
        ${propsList(assetPhysicsSpec)}
      </div>
    </div>
    <p class="note">Relational fields — <code>force.towardAssetId</code>, <code>magnet.targetAssetId</code>, <code>carryFromScene.assetId</code> — all target another asset's <code>id</code> in the same scene (or, for <code>carryFromScene</code>, an earlier scene), the same "everything can be relative" pattern as anchors and timing.</p>
  </section>`;
}

function buildEffectsSection() {
  return `
  <section id="effects">
    <h2>Effects</h2>
    <p class="lede">Three non-overlapping effect surfaces — don't confuse them. Per-asset visual effects (<code>asset.effects[]</code>: filter/grain/scanlines scoped to one asset's box) vs. detached scene-level effects (<code>scene.effects[]</code>: sfx/visual anchored to an exact scene-local <code>frame</code>) vs. <code>config.postEffects</code> (a whole-video ffmpeg pass after render). This section covers scene-level effects — the newest, exact-frame-first member of the timing pattern.</p>
    <div class="grid two">
      <div class="schema-card">
        <h3>sfxEffect</h3>
        ${propsList(sfxEffect)}
      </div>
      <div class="schema-card">
        <h3>visualEffect</h3>
        ${propsList(visualEffect)}
      </div>
      <div class="schema-card">
        <h3>effects aliases <span class="count">${(aliasesByCategory.effects ?? []).length}</span></h3>
        ${aliasCardList(aliasesByCategory.effects)}
      </div>
      <div class="schema-card">
        <h3>shader aliases <span class="count">${(aliasesByCategory.shader ?? []).length}</span></h3>
        ${aliasCardList(aliasesByCategory.shader)}
      </div>
    </div>
  </section>`;
}

function buildTimingSection() {
  return `
  <section id="timing">
    <h2>Timing</h2>
    <p class="lede">The one shared vocabulary for "fire at this moment" — <code>shared.schema.json#/definitions/timingAnchor</code>. Consumed by asset <code>enterAt</code>/<code>exitAt</code>, scene <code>effects[].timing</code> (legacy bridge), and camera <code>actions[].at</code>. Resolved by <code>src/timing/effectTiming.js</code>'s <code>resolveTimingAnchor</code>.</p>
    <div class="grid two">
      <div class="schema-card">
        <h3>timingAnchor</h3>
        ${propsList(timingAnchor.oneOf?.[0] ?? timingAnchor)}
      </div>
      <div class="schema-card">
        <h3>timing aliases <span class="count">${(aliasesByCategory.timing ?? []).length}</span></h3>
        ${aliasCardList(aliasesByCategory.timing)}
      </div>
    </div>
  </section>`;
}

function buildAliasSection() {
  return `
  <section id="aliases">
    <h2>"$alias" shorthand</h2>
    <p class="lede">Any of <code>motion</code>, <code>camera</code>, <code>transitionOut</code>, per-asset <code>effects</code>, or a <code>timingAnchor</code> field can be written as <code>{ "$alias": "category.name", ...vars }</code> instead of the full object — expanded by <code>resolveAliasesDeep</code> in pipeline2, <strong>before</strong> validate's shaped schemas see it. Hand-authored files must write the expanded shape (validate rejects a bare <code>$alias</code> key); only the agent CLIs (<code>agent-cli.mjs add-asset</code>/<code>add-scene</code>, etc.) resolve aliases before validating. Discover: <code>node scripts/discovery.mjs aliases</code> / <code>alias &lt;name&gt;</code>.</p>
    <div class="grid two">
      <div class="schema-card">
        <h3>text aliases <span class="count">${(aliasesByCategory.text ?? []).length}</span></h3>
        ${aliasCardList(aliasesByCategory.text)}
      </div>
      <div class="schema-card">
        <h3>transition aliases <span class="count">${(aliasesByCategory.transition ?? []).length}</span></h3>
        ${aliasCardList(aliasesByCategory.transition)}
      </div>
    </div>
  </section>`;
}

function aliasCardList(list) {
  if (!list || list.length === 0) return `<p class="empty">none</p>`;
  return `<ul class="alias-list">${list
    .map(
      (a) =>
        `<li><code>${esc(a.name)}</code> <span class="src ${a.source}">${esc(a.source)}</span><br><span class="alias-desc">${esc(
          a.description,
        )}</span>${a.vars?.length ? `<br><span class="vars">vars: ${a.vars.map((v) => code(v)).join(", ")}</span>` : ""}</li>`,
    )
    .join("")}</ul>`;
}

function buildBackgroundSection() {
  return `
  <section id="background">
    <h2>Backgrounds & style tokens</h2>
    <p class="lede"><code>scene.background</code> — a color token, a literal hex, or an object with texture/blend/opacity (<code>shared.schema.json#/definitions/backgroundSpec</code>). Tokens resolve against <code>styles/theme.json</code> — colors, typography, spacing, easing, textures.</p>
    <div class="grid two">
      <div class="schema-card">
        <h3>backgroundSpec</h3>
        ${propsList(backgroundSpec.oneOf?.[1] ?? backgroundSpec)}
      </div>
      <div class="schema-card">
        <h3>themes <span class="count">${themes.length}</span></h3>
        <ul class="alias-list">${themes
          .map(
            (t) =>
              `<li><code>${esc(t.name)}</code> — ${t.colorTokens} colors, ${t.typographyTokens} typography, ${t.easingTokens} easing</li>`,
          )
          .join("")}</ul>
      </div>
    </div>
  </section>`;
}

function buildCollectionsSection() {
  const cards = collections
    .map(
      (c) => `
    <article class="card" data-search="${esc((c.collectionType + " " + c.label + " " + c.description).toLowerCase())}">
      <h3>${esc(c.label)}</h3>
      <p>${esc(c.description)}</p>
      <div class="meta">${pill(c.category)}${pill(c.destination)}</div>
    </article>`,
    )
    .join("\n");
  return `
  <section id="collections">
    <h2>Asset gathering <span class="count">${collections.length}</span></h2>
    <p class="lede">Workflows for pulling stock video, images, and audio into <code>public/</code> before authoring scenes. Discover live: <code>node scripts/discovery.mjs collections</code> / <code>collection &lt;type&gt;</code>. Docs under <code>docs/skills/assetlibrary/</code>.</p>
    <div class="grid">${cards}</div>
  </section>`;
}

function buildSchemaSection() {
  const cards = schemas
    .map(
      (s) => `
    <article class="card" data-search="${esc(s.file.toLowerCase())}">
      <h3>${esc(s.file)}</h3>
      ${s.required.length ? `<p><strong>required:</strong> ${s.required.map(code).join(", ")}</p>` : ""}
      ${s.topLevelProperties.length ? `<p><strong>properties:</strong> ${s.topLevelProperties.map(code).join(", ")}</p>` : ""}
      ${s.definitions.length ? `<p><strong>definitions:</strong> ${s.definitions.map(code).join(", ")}</p>` : ""}
    </article>`,
    )
    .join("\n");
  return `
  <section id="schemas">
    <h2>Schema files <span class="count">${schemas.length}</span></h2>
    <p class="lede"><code>src/pipelines/pipeline1-validate/schema/*.schema.json</code> — the Ajv contract every manifest/scene file is checked against. Fully dereferenced, live: <code>node scripts/schema-cli.mjs schema &lt;file&gt;</code>, <code>definition &lt;file&gt; &lt;name&gt;</code>, <code>search &lt;term&gt;</code>.</p>
    <div class="grid">${cards}</div>
  </section>`;
}

function buildCliSection() {
  return `
  <section id="cli">
    <h2>CLI surfaces</h2>
    <div class="grid three">
      <div class="schema-card">
        <h3><code>scripts/discovery.mjs</code></h3>
        <p>Read-only discovery + build/verify/render. Backed by the registries (<code>studio/assets</code>, <code>studio/graphics</code>, <code>studio/transitions</code>, <code>src/registry/aliasRegistry.js</code>, <code>src/registry/themeLibrary.js</code>).</p>
        <pre>assets / asset &lt;type&gt;
transitions / transition &lt;type&gt;
anchors
envelope / manifest
pitfalls [topic]
aliases [category] / alias &lt;name&gt;
alias-categories
themes / theme &lt;name&gt;
collections / collection &lt;type&gt;
projects / show &lt;id&gt;</pre>
      </div>
      <div class="schema-card">
        <h3><code>scripts/timeline-cli.mjs</code></h3>
        <p>Dynamic, per-project frame-axis introspection + injection — resolves fresh from disk every call. <code>outline</code> returns a compact hierarchical (DAG-shaped) view for cheap first reads; <code>scene</code> drills into one scene's full detail.</p>
        <pre>outline &lt;id&gt; / scene &lt;id&gt; &lt;sceneId&gt;
timeline &lt;id&gt; / describe-frame &lt;id&gt; &lt;frame&gt;
open-ranges &lt;id&gt; &lt;scene&gt;
inject-effects &lt;id&gt; '&lt;rules&gt;'</pre>
      </div>
      <div class="schema-card">
        <h3><code>scripts/schema-cli.mjs</code></h3>
        <p>Read-only discovery over <code>src/pipelines/pipeline1-validate/schema/</code> directly. $ref-dereferenced, oneOf-flattened. Zero second source of truth — a new schema field shows up here automatically.</p>
        <pre>schemas
schema &lt;file|id&gt;
definitions &lt;file|id&gt;
definition &lt;file|id&gt; &lt;name&gt;
search &lt;term&gt;</pre>
      </div>
      <div class="schema-card">
        <h3><code>scripts/cli.js</code> / <code>project-cli.js</code></h3>
        <p>Mutation surface — creates/edits projects, scenes, assets, styles, themes, aliases against an ACTIVE project. <code>project-cli.js create</code> is the dedicated scaffolding entry point.</p>
        <pre>project create|current|validate
scene create|...
asset create|get|delete
styles * / theme * / alias *
manifest export
batch</pre>
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Assemble page
// ---------------------------------------------------------------------------

const generatedAt = new Date().toISOString();

const nav = [
  ["pattern", "The pattern"],
  ["assets", `Assets (${assets.length})`],
  ["transitions", `Transitions (${transitions.length})`],
  ["motion", "Motion"],
  ["camera", "Camera"],
  ["physics", "Physics"],
  ["effects", "Effects"],
  ["timing", "Timing"],
  ["aliases", "$alias shorthand"],
  ["background", "Backgrounds & themes"],
  ["collections", "Asset gathering"],
  ["schemas", "Schema files"],
  ["cli", "CLI surfaces"],
]
  .map(([id, label]) => `<a href="#${id}">${esc(label)}</a>`)
  .join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>json.mp4 — framework reference</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: #0b0e14; --panel: #131826; --border: #232a3b; --text: #e6e9f0;
    --muted: #8a93a8; --accent: #3d7bfd; --accent2: #6ee7b7; --warn: #f0b429;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
  }
  header {
    padding: 48px 32px 24px; max-width: 1100px; margin: 0 auto;
  }
  header h1 { font-size: 32px; margin: 0 0 8px; }
  header p.sub { color: var(--muted); max-width: 720px; }
  header .generated { color: var(--muted); font-size: 12px; margin-top: 16px; }
  nav.toc {
    position: sticky; top: 0; z-index: 10; background: rgba(11,14,20,0.92);
    backdrop-filter: blur(6px); border-bottom: 1px solid var(--border);
    padding: 10px 32px; display: flex; gap: 4px; flex-wrap: wrap;
  }
  nav.toc a {
    color: var(--muted); text-decoration: none; font-size: 13px;
    padding: 6px 10px; border-radius: 6px;
  }
  nav.toc a:hover { color: var(--text); background: var(--panel); }
  main { max-width: 1100px; margin: 0 auto; padding: 32px; }
  section { margin-bottom: 56px; scroll-margin-top: 56px; }
  section h2 {
    font-size: 22px; border-bottom: 1px solid var(--border); padding-bottom: 10px;
    display: flex; align-items: center; gap: 10px;
  }
  .count {
    font-size: 12px; color: var(--accent); background: rgba(61,123,253,0.12);
    padding: 2px 8px; border-radius: 999px; font-weight: 600;
  }
  p.lede { color: var(--muted); max-width: 860px; }
  p.note { color: var(--warn); font-size: 13px; }
  code { background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 4px; font-size: 0.92em; }
  pre {
    background: #0e1220; border: 1px solid var(--border); border-radius: 8px;
    padding: 12px 14px; overflow-x: auto; font-size: 12.5px; color: var(--accent2);
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; margin-top: 18px; }
  .grid.two { grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); }
  .grid.three { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  .card, .schema-card {
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 16px 18px;
  }
  .card h3, .schema-card h3 { margin: 0 0 8px; font-size: 15px; color: var(--text); }
  .card p, .schema-card p { margin: 0 0 6px; color: var(--muted); font-size: 13.5px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .pill {
    font-size: 11px; color: var(--accent2); background: rgba(110,231,183,0.1);
    border: 1px solid rgba(110,231,183,0.25); padding: 2px 8px; border-radius: 999px;
  }
  dl.props { margin: 0; }
  dl.props dt { margin-top: 10px; font-size: 13.5px; }
  dl.props dt:first-child { margin-top: 0; }
  dl.props dd { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
  .req { color: var(--warn); font-size: 10px; text-transform: uppercase; margin-left: 4px; }
  .opt { color: var(--muted); font-size: 10px; text-transform: uppercase; margin-left: 4px; }
  .kind { color: var(--accent); }
  ul.alias-list { list-style: none; margin: 0; padding: 0; }
  ul.alias-list li { padding: 8px 0; border-top: 1px solid var(--border); font-size: 13px; }
  ul.alias-list li:first-child { border-top: none; padding-top: 0; }
  .alias-desc { color: var(--muted); }
  .vars { color: var(--muted); font-size: 12px; }
  .src { font-size: 10px; text-transform: uppercase; margin-left: 6px; padding: 1px 6px; border-radius: 999px; }
  .src.builtin { color: var(--accent); background: rgba(61,123,253,0.1); }
  .src.custom { color: var(--warn); background: rgba(240,180,41,0.1); }
  .empty { color: var(--muted); font-style: italic; }
  #search {
    width: 100%; max-width: 420px; padding: 8px 12px; margin: 16px 0 0;
    background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
    color: var(--text); font-size: 14px;
  }
  .hidden { display: none !important; }
  footer { color: var(--muted); font-size: 12px; text-align: center; padding: 24px; }
</style>
</head>
<body>
<header>
  <h1>json.mp4 — framework reference</h1>
  <p class="sub">An AI-agent-friendly JSON-to-MP4 video framework built on Remotion. Author small typed JSON (manifest → config → scenes); three pipelines (validate → resolve → render) turn it into an MP4. This page is a generated, browsable map of everything the framework exposes — assets, transitions, motion, camera, physics, effects, timing, aliases, themes, and the schema contracts behind them.</p>
  <input id="search" type="search" placeholder="Filter assets / transitions / collections / schemas…">
  <p class="generated">Generated ${esc(generatedAt)} by <code>node scripts/build-index.mjs</code> from live registries and schema files — re-run after adding an asset, transition, alias, theme, or schema field.</p>
</header>
<nav class="toc">${nav}</nav>
<main>
${buildPatternSection()}
${buildAssetsSection()}
${buildTransitionsSection()}
${buildMotionSection()}
${buildCameraSection()}
${buildPhysicsSection()}
${buildEffectsSection()}
${buildTimingSection()}
${buildAliasSection()}
${buildBackgroundSection()}
${buildCollectionsSection()}
${buildSchemaSection()}
${buildCliSection()}
</main>
<footer>json.mp4 · generated reference · see <code>CLAUDE.md</code> for the authoring pattern and <code>scripts/curate/</code> for worked solutions</footer>
<script>
  const input = document.getElementById('search');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('[data-search]').forEach((el) => {
      el.classList.toggle('hidden', q.length > 0 && !el.dataset.search.includes(q));
    });
  });
</script>
</body>
</html>
`;

const outPath = path.join(repoRoot, "index.html");
fs.writeFileSync(outPath, html);
console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(1)} KB)`);
