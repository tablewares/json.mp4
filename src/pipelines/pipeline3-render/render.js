import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bundles src/index.jsx and renders the "Video" composition to mp4. Assumes
 * pipeline2 has already written resolved.json (index.jsx imports it
 * directly), so this step never re-touches the manifest, styles, or asset
 * registry — it only knows about Remotion's own APIs.
 */
async function main() {
  const outputPath = process.argv[2] ?? path.join(__dirname, "../../../out/video.mp4");
  const entryPoint = path.join(__dirname, "../../index.jsx");

  console.log("Bundling...");
  const bundleLocation = await bundle({ entryPoint });

  console.log("Selecting composition...");
  const composition = await selectComposition({ serveUrl: bundleLocation, id: "Video" });

  console.log(`Rendering to ${outputPath} ...`);
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
  });

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
