/**
 * format-plan.mjs — render a motion-continuity plan result (see
 * motion-continuity.mjs's `result` shape) as either JSON or a compact
 * Markdown table + continuity summary + usage note.
 */
export function formatJson(result) {
  return JSON.stringify(result, null, 2);
}

export function formatMarkdown(result) {
  const { seed, axis, curveShape, amplitudePx, vertexT, sceneCount, scenes, continuityLinks, usageNote } = result;
  const cameraOn = result.cameraEnabled;

  const lines = [];
  lines.push(`# Motion continuity plan — seed ${seed}`);
  lines.push("");
  lines.push(
    `Axis: ${axis} | Curve: ${curveShape} | Amplitude: ${amplitudePx}px | Vertex t: ${vertexT} | Scenes: ${sceneCount} | Camera: ${
      cameraOn ? `on (chance ${result.cameraChance}, ${result.scenesWithCamera}/${sceneCount} rolled)` : "off"
    }`
  );
  lines.push("");

  if (cameraOn) {
    lines.push("| # | id | in alias | in px | in tier | out alias | out px | out tier | camera | start anchor | focus enterAt | zoom% | focus asset |");
    lines.push("|---|----|---------|-------|---------|-----------|--------|----------|--------|---------------|----------------|-------|-------------|");
    for (const sc of scenes) {
      const cam = sc.camera;
      lines.push(
        `| ${sc.sceneIndex} | ${sc.sceneId} | ${sc.motion.in.alias} | ${sc.motion.in.distancePx} | ${sc.intensity.in} | ${sc.motion.out.alias} | ${sc.motion.out.distancePx} | ${sc.intensity.out} | ${cam ? "yes" : "no"} | ${cam ? cam.actions[0].anchor.position : "-"} | ${cam ? cam.focusEnterAt : "-"} | ${cam ? cam.actions[cam.actions.length - 1].zoomPercent : "-"} | ${cam ? cam.actions[cam.actions.length - 1].anchor.followAssetId : "-"} |`
      );
    }
  } else {
    lines.push("| # | id | in alias | in px | in tier | out alias | out px | out tier |");
    lines.push("|---|----|---------|-------|---------|-----------|--------|----------|");
    for (const sc of scenes) {
      lines.push(
        `| ${sc.sceneIndex} | ${sc.sceneId} | ${sc.motion.in.alias} | ${sc.motion.in.distancePx} | ${sc.intensity.in} | ${sc.motion.out.alias} | ${sc.motion.out.distancePx} | ${sc.intensity.out} |`
      );
    }
  }

  lines.push("");
  lines.push("Continuity across cuts:");
  for (const link of continuityLinks) {
    lines.push(`- ${link.fromScene} -> ${link.toScene}: ${link.continuous ? "continuous" : "BREAK"} (${link.outDirection} -> ${link.inDirection})`);
  }
  lines.push("");
  lines.push(usageNote);

  return lines.join("\n");
}
