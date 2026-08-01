import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createLogger } from "../../util/logger.js";
import { buildTimeline } from "../../timing/buildTimeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger("render");

/**
 * Bundles src/index.jsx and renders the "Video" composition to mp4. Assumes
 * pipeline2 has already written resolved.json (index.jsx imports it directly),
 * so this step never re-touches the manifest, styles, or asset registry —
 * it only knows about Remotion's own APIs.
 *
 * After a successful render it also writes a timing.json next to the output
 * with the global timeline (scenes, assets, transitions, voiceover).
 */
async function main() {
  const outputPath = process.argv[2] ?? path.join(__dirname, "../../../out/video.mp4");
  const entryPoint = path.join(__dirname, "../../index.jsx");
  const resolvedGraphPath = path.join(__dirname, "../../../resolved.json");

  log.info("Bundling...");
  const bundleLocation = await bundle({ entryPoint });

  log.info("Selecting composition...");
  const composition = await selectComposition({ serveUrl: bundleLocation, id: "Video" });

  log.info(`Rendering to ${outputPath} ...`);
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
  });

  // Write the post-render timing report from the resolved graph. This is a
  // pure computation over resolved.json — no re-render or external service.
  try {
    const resolvedGraph = JSON.parse(fs.readFileSync(resolvedGraphPath, "utf-8"));
    const timeline = buildTimeline(resolvedGraph);
    const timingPath = path.join(path.dirname(outputPath), "timing.json");
    fs.writeFileSync(timingPath, JSON.stringify(timeline, null, 2));
    log.info(
      `Timeline written to ${timingPath} ` +
        `(${timeline.scenes.length} scenes, ${timeline.assets.length} assets, ` +
        `${timeline.transitions.length} transitions, ${timeline.voiceover.length} voiceover track(s))`
    );
  } catch (err) {
    log.warn(`Could not write timing.json: ${err?.message || err}`);
  }

  log.info("Done.");
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
