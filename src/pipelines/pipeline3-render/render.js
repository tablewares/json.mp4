import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { applyPostEffects } from "./postEffects.js";
import { sweepStaleBundles } from "./bundleCleanup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const finalOutputPath = process.argv[2] ?? path.join(__dirname, "../../../out/video.mp4");
  const entryPoint = path.join(__dirname, "../../index.jsx");
  const resolvedPath = path.join(__dirname, "../../../studio/resolved.json");

  console.log("Bundling...");
  const bundleLocation = await bundle({ entryPoint });

  try {
    console.log("Selecting composition...");
    const composition = await selectComposition({ serveUrl: bundleLocation, id: "Video" });

    const resolvedConfig = fs.existsSync(resolvedPath)
      ? JSON.parse(fs.readFileSync(resolvedPath, "utf-8")).config
      : undefined;
    const postEffects = resolvedConfig?.postEffects;

    const rawRenderPath = postEffects
      ? path.join(__dirname, "../../../out/.raw-render.mp4")
      : finalOutputPath;
    fs.mkdirSync(path.dirname(rawRenderPath), { recursive: true });

    console.log(`Rendering to ${rawRenderPath} ...`);
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: "h264",
      outputLocation: rawRenderPath,
    });

    if (postEffects) {
      console.log("Applying post-cinematography effects...");
      applyPostEffects(rawRenderPath, finalOutputPath, postEffects, {
        width: resolvedConfig.width,
        height: resolvedConfig.height,
      });
      fs.unlinkSync(rawRenderPath);
    }

    console.log("Done.");
  } finally {
    // Runs on both success and failure — a thrown renderMedia error must
    // not leak the bundle dir. Best-effort: a cleanup failure (e.g. a file
    // still locked by a lingering headless-Chrome process) is logged, not
    // thrown, so it never masks the render's own success/failure.
    try {
      fs.rmSync(bundleLocation, { recursive: true, force: true });
      console.log(`Cleaned up bundle: ${bundleLocation}`);
    } catch (cleanupErr) {
      console.warn(`Failed to remove bundle dir ${bundleLocation}: ${cleanupErr.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});