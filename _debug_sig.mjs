import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProject } from "./src/pipelines/pipeline1-validate/validate.js";
import { loadAssetRegistry, loadTransitionRegistry } from "./src/registry/assetRegistry.js";
import { resolveScene } from "./src/pipelines/pipeline2-resolve/resolveScene.js";
import { resolveTransitionEffects, buildTransitionBundle } from "./src/pipelines/pipeline2-resolve/resolveTransitions.js";
import { _internals as I } from "./src/pipelines/pipeline2-resolve/plugins/similarSceneGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function resolveScenesNoEnforce(manifestRel) {
  const manifestPath = path.join(__dirname, manifestRel);
  const { config, styles, scenes } = validateProject(manifestPath);
  const assetRegistry = loadAssetRegistry();
  const transitionRegistry = loadTransitionRegistry();
  const resolvedScenes = scenes.map((scene, i) =>
    resolveScene(scene, { styles, assetRegistry, config, timingById: {}, narrationTextById: {}, hasNarration: false, isLastScene: i === scenes.length - 1 }),
  );
  for (let i = 0; i < resolvedScenes.length; i += 1) {
    const outgoing = resolvedScenes[i];
    const incoming = resolvedScenes[i + 1];
    if (!incoming) { outgoing.effects = []; continue; }
    outgoing.transitionOut = buildTransitionBundle(scenes[i].transitionOut, outgoing, incoming, transitionRegistry);
    incoming.transitionIn = outgoing.transitionOut;
    outgoing.effects = [];
  }
  return resolvedScenes;
}

async function detail(manifest) {
  console.log("\n=== " + manifest + " ===");
  const scenes = await resolveScenesNoEnforce(manifest);
  for (const s of scenes) {
    console.log(
      s.id,
      "bg=" + JSON.stringify(I.backgroundSignature(s)),
      "bgBucket=" + JSON.stringify(I.backgroundDiversityBucket(s)),
      "assets=" + JSON.stringify(I.assetTypeSignature(s)),
      "cam=" + JSON.stringify(I.cameraSignature(s)),
      "trans=" + JSON.stringify(I.transitionSignature(s)),
    );
  }
  const opts = {
    compareBackground: true, compareAssetTypes: true, compareCamera: true, compareTransition: true,
    groupNearbyShadeBackgrounds: true, minDistinct: 3, minScenesToEnforceDiversity: 4, maxConsecutiveSimilar: 2,
  };
  console.log("diversity:", JSON.stringify(I.diversityFindings(scenes, opts), null, 0));
  console.log("runs:", JSON.stringify(I.consecutiveRunFindings(scenes, opts), null, 0));
}

await detail("./studio/manifest/inflation-basics/manifest.json");
await detail("./studio/manifest/inflation-causes-us/manifest.json");
