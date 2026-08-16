import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolveWavyPath, buildWavyPathD } from "../src/templating/wavyPath.js";
import { resolveSceneRefs } from "../src/pipelines/pipeline2-resolve/resolveRefs.js";

// 3 collinear-ish points; spline output diverges from piecewise on >=3 pts.
const PTS3 = [
  { x: 0, y: 0 },
  { x: 100, y: 50 },
  { x: 200, y: 0 },
];
const COMPOSITION = { width: 800, height: 600 };

function makeAsset(styleOverride) {
  return {
    id: "wl-1",
    assetType: "WavyLine",
    content: { points: PTS3.map((p) => ({ ...p })) },
    resolvedStyle: {
      width: 800,
      height: 600,
      // resolvedStyle carries resolved styleOverride fields, including these:
      ...(styleOverride ?? {}),
    },
    timing: { durationInFrames: 90, enterAtFrame: 0, exitAtFrame: 90, words: null },
  };
}

test("resolveWavyPath threads smoothCurve through buildWavyPathD", () => {
  const spline = resolveWavyPath(PTS3, 0, true).d;
  const piece = resolveWavyPath(PTS3, 0, false).d;
  assert.ok(spline.startsWith("M 0 0"), "spline d should start at first point");
  assert.ok(piece.startsWith("M 0 0"), "piecewise d should start at first point");
  assert.notEqual(spline, piece, "spline and piecewise must differ for 3 pts");
  // Sanity: the spline shape for 3 input pts is M + two C segments.
  const splineCSegs = (spline.match(/C/g) ?? []).length;
  const pieceCSegs = (piece.match(/C/g) ?? []).length;
  assert.equal(splineCSegs, 2, "3-pt spline -> 2 bezier segments");
  assert.equal(pieceCSegs, 2, "3-pt piecewise -> 2 bezier segments");
  assert.notEqual(spline, piece, "control-point coords must differ");
});

test("REGRESSION: pass-2 resolution baked spline path for smoothCurve:true (3pts)", () => {
  const assets = [makeAsset({ curveAmount: 0, smoothCurve: true })];
  resolveSceneRefs(assets, { sceneId: "s1", composition: COMPOSITION });
  const baked = assets[0].content._path?.d;
  assert.ok(typeof baked === "string" && baked.length > 0, "_path.d should be baked");
  // The pre-fix bug baked the PIECEWISE path (smoothCurve ignored by bakeWavyPathSurface).
  // The renderer reads content._path.d first, so smoothCurve was silently dropped.
  // After fix: the baked d must match the spline output of buildWavyPathD(pts, 0, true).
  const expectedSpline = buildWavyPathD(PTS3, 0, true);
  assert.equal(
    baked,
    expectedSpline,
    "baked _path.d should equal the smooth-spline output, not the piecewise output",
  );
  assert.notEqual(
    baked,
    buildWavyPathD(PTS3, 0, false),
    "regression check: must NOT equal the piecewise (pre-fix) output",
  );
});

test("BACKCOMPAT: pass-2 resolution bakes piecewise path when smoothCurve omitted", () => {
  const assets = [makeAsset({ curveAmount: 0 })];
  resolveSceneRefs(assets, { sceneId: "s1", composition: COMPOSITION });
  const baked = assets[0].content._path?.d;
  assert.ok(typeof baked === "string" && baked.length > 0, "_path.d should be baked");
  // No smoothCurve flag -> byte-identical to the pre-fix (piecewise) output.
  assert.equal(
    baked,
    buildWavyPathD(PTS3, 0, false),
    "omitting smoothCurve must produce byte-identical pre-fix piecewise output",
  );
});

test("Connector path also honors smoothCurve when baked", () => {
  // Two anchor boxes; the connector resolves fromAssetId/toAssetId into
  // resolved pixel endpoints and then calls bakeWavyPathSurface.
  const a = {
    id: "a",
    assetType: "Box",
    content: {},
    resolvedStyle: { width: 40, height: 40 },
    resolvedPosition: { left: 10, top: 10 },
    timing: { durationInFrames: 90, enterAtFrame: 0, exitAtFrame: 90, words: null },
  };
  const b = {
    id: "b",
    assetType: "Box",
    content: {},
    resolvedStyle: { width: 40, height: 40 },
    resolvedPosition: { left: 700, top: 500 },
    timing: { durationInFrames: 90, enterAtFrame: 0, exitAtFrame: 90, words: null },
  };
  const connector = {
    id: "c",
    assetType: "WavyLine",
    content: { fromAssetId: "a", toAssetId: "b" },
    resolvedStyle: { width: 800, height: 600, curveAmount: 0.2, smoothCurve: false },
    timing: { durationInFrames: 90, enterAtFrame: 0, exitAtFrame: 90, words: null },
  };
  // Connectors produce 2 resolved endpoints -> piecewise (smooth gated to >=3 pts).
  // Bake the expected piecewise from the resolved endpoints.
  const assets = [a, b, connector];
  resolveSceneRefs(assets, { sceneId: "s1", composition: COMPOSITION });
  assert.ok(connector.content._path?.d, "connector should bake _path.d");
  assert.equal(connector.content._path.d, buildWavyPathD(connector.content.points, 0.2, false));
  assert.ok(
    Number.isFinite(connector.content._path.length) && connector.content._path.length > 0,
    "_path.length should be a finite positive number",
  );
});

test("2-point smoothCurve:true falls back to piecewise shape (no crash)", () => {
  const two = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const d = resolveWavyPath(two, 0, true).d;
  // buildSmoothSplineD short-circuits to buildSegmentD for length === 2.
  assert.equal(d, resolveWavyPath(two, 0, false).d);
});

test("No-capacity guard: <2 points bakes nothing", () => {
  const assets = [makeAsset({ smoothCurve: true })];
  assets[0].content.points = [{ x: 0, y: 0 }];
  resolveSceneRefs(assets, { sceneId: "s1", composition: COMPOSITION });
  assert.equal(assets[0].content._path, undefined, "single-point input should not bake _path");
});
