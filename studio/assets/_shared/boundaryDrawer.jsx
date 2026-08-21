import React from "react";
import { interpolate, delayRender, continueRender, staticFile } from "remotion";

/**
 * Shared self-drawing dashed/dotted boundary outline for SVG-based assets.
 *
 * Two measurement strategies, both feeding the same `<BoundaryDrawer>`:
 *
 *  - `useMeasuredBounds` — DOM `getBBox()` of a group. Fast, exact for
 *    rectangular/text content, but for an image this is the element's
 *    declared box, NOT the shape of its actual opaque pixels. A circular
 *    logo inside a square `<image>` box measures as a square.
 *  - `useAlphaSilhouette` — rasterizes the actual image onto an offscreen
 *    canvas and reads its alpha channel, so the traced outline hugs the
 *    real non-transparent pixels (the circle), not the bounding square.
 *    Use this whenever the boundary needs to read "around the real pixels".
 *
 * Both actually DRAW themselves in over time — the visible dashed stroke is
 * clipped by an animated `<mask>` whose own reveal-stroke grows from 0 to
 * the shape's full perimeter/length via the classic stroke-dashoffset trick
 * (same technique WavyLine/DrawLine/PathFlow use). A plain
 * `strokeDasharray`/`strokeDashoffset` animation on a short repeating dash
 * pattern does NOT achieve this — once the offset exceeds one dash+gap
 * period the pattern just cycles in place and every dash is visible from
 * frame 1, which reads as "already fully drawn". The mask is what makes a
 * DASHED line (as opposed to a solid one) draw itself progressively.
 *
 * Usage — rect/bbox mode (panels, text blocks):
 *
 *   const contentRef = React.useRef(null);
 *   const bounds = useMeasuredBounds(contentRef, [title, body, width, height]);
 *   ...
 *   <svg ...>
 *     <g ref={contentRef}>{...the asset's real content...}</g>
 *     <BoundaryDrawer bounds={bounds} frame={frame} enterAtFrame={enterAtFrame}
 *       exitAtFrame={exitAtFrame} envelope={envelope}
 *       stroke={resolvedStyle.boundaryStrokeColorToken ?? "#FFFFFF"} />
 *   </svg>
 *
 * Usage — alpha-silhouette mode (images with transparency, e.g. round logos):
 *
 *   const silhouette = useAlphaSilhouette(src, { width, height, inset: 10 });
 *   ...
 *   <BoundaryDrawer points={silhouette?.points} frame={frame}
 *     enterAtFrame={enterAtFrame} exitAtFrame={exitAtFrame} envelope={envelope}
 *     stroke={resolvedStyle.boundaryStrokeColorToken ?? "#FFFFFF"} />
 *
 * `points` takes priority over `bounds` when both are passed.
 *
 * Delaying the draw (image/content lands first, THEN the boundary starts):
 * pass a later `enterAtFrame` than the host content's own — e.g.
 * `hostEnterAtFrame + delayFrames`, or a fraction of the active window. Both
 * shipped call sites (SvgImage) expose this as a `boundaryDelayFrames` /
 * `boundaryDelayFraction` style pair rather than hardcoding the gap, so an
 * author can tune (or zero out) the delay per asset instance.
 *
 * `stroke` (and any other raw-hex-looking prop on this component) is a
 * literal render value the *caller* already resolved from a manifest style
 * token (styleRegistry.resolveAssetStyle resolves any manifest field whose
 * name contains "color" — e.g. `boundaryStrokeColorToken` — before this
 * component ever sees it). This component itself takes concrete values only
 * and does no token resolution.
 */

/**
 * Measures a ref'd SVG element's live bounding box via `getBBox()` inside a
 * layout effect, re-measuring whenever `deps` changes (pass whatever inputs
 * affect the measured content's rendered geometry — text, width, height,
 * padding, etc). Returns `null` until the first successful measurement, so
 * callers should treat an absent `bounds` as "not ready yet" and skip
 * rendering the boundary (BoundaryDrawer already no-ops on `bounds == null`).
 *
 * `getBBox()` is a real DOM layout measurement — it works identically in
 * Remotion's headless-Chromium render as it does in a browser preview, so
 * this stays deterministic across the studio and the renderer.
 *
 * NOTE: for an `<image>`/`<img>`, this is the element's declared box, not
 * the shape of its opaque pixels — a circular logo in a square image box
 * still measures as a square. Use `useAlphaSilhouette` when the boundary
 * needs to hug the actual non-transparent pixels instead.
 */
export function useMeasuredBounds(ref, deps = []) {
  const [bounds, setBounds] = React.useState(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.getBBox !== "function") return;
    try {
      const box = el.getBBox();
      if (box.width > 0 && box.height > 0) {
        setBounds({ x: box.x, y: box.y, width: box.width, height: box.height });
      }
    } catch {
      // getBBox can throw on a not-yet-laid-out / detached node; keep
      // whatever bounds we already have rather than clearing them.
    }
    // deps drive re-measurement; ref itself is stable across the asset's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return bounds;
}

/**
 * Rasterizes `src` onto an offscreen canvas and reads its alpha channel to
 * build a silhouette polygon of the actual non-transparent pixels — the
 * real visual shape of the image, not its rectangular bounding box.
 *
 * Traces one horizontal-run-per-row silhouette (leftmost/rightmost opaque
 * pixel per sampled row, walked down the right edge then back up the left
 * edge). Exact for convex-per-row shapes — circles, blobs, most logos/icons
 * — which covers the common "round image, square canvas" case this exists
 * for. Shapes with multiple disconnected horizontal bands in the same row
 * (e.g. a ring) will bridge across the gap; that's a known limitation of
 * the single-run-per-row approach, not a bug to chase for this use case.
 *
 * Blocks Remotion's render (via delayRender/continueRender) until the image
 * has loaded and been analyzed, so every rendered frame — not just preview
 * frames — sees the final silhouette rather than a mid-load empty state.
 *
 * @param {string} src  path relative to public/ (resolved via staticFile())
 *        or an absolute http(s) URL
 * @param {object} [options]
 * @param {number} options.width  image display width, local viewBox units
 * @param {number} options.height  image display height, local viewBox units
 * @param {number} [options.inset=0]  px to expand the traced silhouette
 *        outward (radially from its centroid) so the line sits just outside
 *        the pixels instead of on top of them
 * @param {number} [options.threshold=16]  alpha value (0-255) above which a
 *        pixel counts as "opaque" for tracing purposes
 * @param {number} [options.sampleSize=128]  raster resolution (px, capped to
 *        the longer image dimension) the alpha channel is sampled at —
 *        higher is smoother but slower; 128 is plenty for a boundary line
 * @returns {{points: Array<[number,number]>}|null} null until the image has
 *        loaded and been analyzed (or on load/analysis failure)
 */
export function useAlphaSilhouette(src, options = {}) {
  const { width, height, inset = 0, threshold = 16, sampleSize = 128 } = options;
  const [silhouette, setSilhouette] = React.useState(null);

  React.useEffect(() => {
    if (!src || !width || !height) return;
    let cancelled = false;
    const handle = delayRender(`alpha-silhouette:${src}`);

    const finish = (value) => {
      if (!cancelled) setSilhouette(value);
      continueRender(handle);
    };

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const aspect = width / height;
        let sw = sampleSize;
        let sh = Math.round(sampleSize / aspect);
        if (sh > sampleSize) {
          sh = sampleSize;
          sw = Math.round(sampleSize * aspect);
        }
        sw = Math.max(2, sw);
        sh = Math.max(2, sh);

        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, sw, sh);
        ctx.drawImage(img, 0, 0, sw, sh);
        const data = ctx.getImageData(0, 0, sw, sh).data;

        const rows = [];
        for (let y = 0; y < sh; y++) {
          let left = -1;
          let right = -1;
          for (let x = 0; x < sw; x++) {
            const a = data[(y * sw + x) * 4 + 3];
            if (a > threshold) {
              if (left === -1) left = x;
              right = x;
            }
          }
          if (left !== -1) rows.push({ y, left, right });
        }

        if (rows.length === 0) {
          finish(null);
          return;
        }

        const scaleX = width / sw;
        const scaleY = height / sh;

        let cx = 0;
        let cy = 0;
        for (const r of rows) {
          cx += ((r.left + r.right) / 2) * scaleX;
          cy += (r.y + 0.5) * scaleY;
        }
        cx /= rows.length;
        cy /= rows.length;

        const expand = (px, py) => {
          if (!inset) return [px, py];
          const dx = px - cx;
          const dy = py - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (dist + inset) / dist;
          return [cx + dx * f, cy + dy * f];
        };

        // Walk down the right edge, then back up the left edge — a single
        // closed, non-self-intersecting polygon for any shape whose rows
        // are each a single contiguous opaque run (circles, most logos).
        const rightEdge = rows.map((r) => expand((r.right + 1) * scaleX, (r.y + 0.5) * scaleY));
        const leftEdge = [...rows].reverse().map((r) => expand(r.left * scaleX, (r.y + 0.5) * scaleY));

        finish({ points: [...rightEdge, ...leftEdge] });
      } catch {
        // Canvas can throw (e.g. a tainted canvas from a genuinely
        // cross-origin src); fall back to "no silhouette" so the caller's
        // bbox-rect fallback (if any) takes over.
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = src.startsWith("http") ? src : staticFile(src);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, width, height, inset, threshold, sampleSize]);

  return silhouette;
}

const DEFAULTS = {
  inset: 8, // px gap between the measured content edge and the drawn line (bbox/rect mode only — silhouette mode bakes inset into the traced points)
  stroke: "#FFFFFF",
  strokeWidth: 2,
  dashArray: 6,
  dashGap: 6,
  rx: 4,
  drawDurationFraction: 0.6, // fraction of THIS component's own active window spent drawing in
  rotateDashes: false, // marching-ants crawl once fully drawn
};

function mergeCfg(props) {
  const { inset, stroke, strokeWidth, dashArray, dashGap, rx, drawDurationFraction, rotateDashes } = props;
  return {
    ...DEFAULTS,
    ...(inset != null ? { inset } : {}),
    ...(stroke != null ? { stroke } : {}),
    ...(strokeWidth != null ? { strokeWidth } : {}),
    ...(dashArray != null ? { dashArray } : {}),
    ...(dashGap != null ? { dashGap } : {}),
    ...(rx != null ? { rx } : {}),
    ...(drawDurationFraction != null ? { drawDurationFraction } : {}),
    ...(rotateDashes != null ? { rotateDashes } : {}),
  };
}

function drawWindow(cfg, frame, enterAtFrame, exitAtFrame, durationInFrames) {
  const activeEnd = exitAtFrame ?? enterAtFrame + (durationInFrames ?? 1);
  const activeFrames = Math.max(1, activeEnd - enterAtFrame);
  const drawFrames = Math.max(1, Math.round(activeFrames * cfg.drawDurationFraction));
  const drawProgress = interpolate(frame, [enterAtFrame, enterAtFrame + drawFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { drawFrames, drawProgress };
}

function crawlOffset(cfg, drawProgress, frame, enterAtFrame, drawFrames) {
  const period = cfg.dashArray + cfg.dashGap;
  return cfg.rotateDashes && drawProgress >= 1 && period > 0
    ? ((frame - (enterAtFrame + drawFrames)) * 0.6) % period
    : 0;
}

function pointsToPathD(points) {
  if (!points || points.length === 0) return "";
  return (
    points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ") + " Z"
  );
}

/**
 * Sanitizes React.useId()'s output (which contains colons, e.g. ":r3:") into
 * a bare alphanumeric string usable as an SVG element id / url(#...) target.
 * Unique per component instance, stable across re-renders — exactly what a
 * per-instance mask id needs.
 */
function useSanitizedId() {
  const raw = React.useId();
  return raw.replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Shared masked-dash renderer: draws `d` with a cosmetic dashed stroke that
 * is progressively revealed by a `<mask>` whose own reveal-stroke grows from
 * 0 to `length` via the standard stroke-dashoffset technique. This is what
 * makes a DASHED (as opposed to solid) line actually draw itself over time
 * instead of appearing fully-dashed on frame 1 — see the module doc comment.
 */
function MaskedDashPath({ d, length, drawProgress, crawl, cfg, envelope }) {
  const idPrefix = useSanitizedId();
  const maskId = `boundary-reveal-${idPrefix}`;
  const revealLen = Math.max(1, length);
  const revealOffset = interpolate(drawProgress, [0, 1], [revealLen, 0]);

  return (
    <>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <path
            d={d}
            fill="none"
            stroke="#ffffff"
            strokeWidth={cfg.strokeWidth + 4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={revealLen}
            strokeDashoffset={revealOffset}
          />
        </mask>
      </defs>
      <path
        d={d}
        fill="none"
        stroke={cfg.stroke}
        strokeWidth={cfg.strokeWidth}
        strokeLinejoin="round"
        strokeDasharray={`${cfg.dashArray} ${cfg.dashGap}`}
        strokeDashoffset={-crawl}
        opacity={Math.max(0, Math.min(1, envelope))}
        pointerEvents="none"
        mask={`url(#${maskId})`}
      />
    </>
  );
}

/**
 * Polygon path variant — used when `points` is supplied (alpha-silhouette
 * mode). Path length is measured off a hidden twin `<path>` via
 * `getTotalLength()`, the same one-time-per-shape measurement technique
 * `WavyLine`/`PathFlow` use for their own self-drawing lines.
 */
function SilhouetteBoundary({ points, frame, enterAtFrame, exitAtFrame, durationInFrames, envelope, ...rest }) {
  const cfg = mergeCfg(rest);
  const d = React.useMemo(() => pointsToPathD(points), [points]);

  const measureRef = React.useRef(null);
  const [length, setLength] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    try {
      setLength(el.getTotalLength());
    } catch {
      setLength(0);
    }
  }, [d]);

  const { drawFrames, drawProgress } = drawWindow(cfg, frame, enterAtFrame, exitAtFrame, durationInFrames);
  const crawl = crawlOffset(cfg, drawProgress, frame, enterAtFrame, drawFrames);

  return (
    <>
      <path ref={measureRef} d={d} fill="none" stroke="none" />
      <MaskedDashPath d={d} length={length} drawProgress={drawProgress} crawl={crawl} cfg={cfg} envelope={envelope} />
    </>
  );
}

/**
 * @param {object} props
 * @param {Array<[number,number]>} [props.points]  closed silhouette polygon
 *        in local viewBox coords (e.g. from `useAlphaSilhouette`). Takes
 *        priority over `bounds` when both are passed.
 * @param {{x:number,y:number,width:number,height:number}|null} [props.bounds]
 *        local-coordinate bounding box to outline (e.g. from
 *        `useMeasuredBounds`). Used only when `points` is absent.
 *        Renders nothing while both `points` and `bounds` are absent.
 * @param {number} props.frame  current scene-local frame from useCurrentFrame()
 * @param {number} props.enterAtFrame  frame the boundary starts drawing —
 *        pass the host's own `enterAtFrame` plus any delay so the boundary
 *        starts after the content it outlines has landed (see the module
 *        doc comment's "Delaying the draw" section).
 * @param {number} [props.exitAtFrame]  frame the boundary's draw window ends;
 *        defaults to enterAtFrame + durationInFrames.
 * @param {number} [props.durationInFrames]  fallback window length when
 *        exitAtFrame is omitted.
 * @param {number} [props.envelope=1]  0..1 opacity multiplier — pass the
 *        host asset's own enter/exit envelope so the line fades with its parent.
 * @param {number} [props.inset]  px gap outside the measured box (bbox mode only)
 * @param {string} [props.stroke]  resolved stroke color (hex)
 * @param {number} [props.strokeWidth]
 * @param {number} [props.dashArray]  dash length, SVG user units
 * @param {number} [props.dashGap]  gap length, SVG user units
 * @param {number} [props.rx]  corner radius (bbox mode only)
 * @param {number} [props.drawDurationFraction]  0..1, fraction of the active
 *        window spent animating the reveal mask from 0 to the full
 *        perimeter/length — this is what makes the dashed line actually
 *        draw itself in rather than appearing complete on the first frame
 * @param {boolean} [props.rotateDashes]  once fully drawn, keep crawling the
 *        dash pattern for a continuous "marching ants" read
 */
export function BoundaryDrawer({
  bounds,
  points,
  frame,
  enterAtFrame = 0,
  exitAtFrame,
  durationInFrames,
  envelope = 1,
  inset,
  stroke,
  strokeWidth,
  dashArray,
  dashGap,
  rx,
  drawDurationFraction,
  rotateDashes,
}) {
  if (points && points.length > 2) {
    return (
      <SilhouetteBoundary
        points={points}
        frame={frame}
        enterAtFrame={enterAtFrame}
        exitAtFrame={exitAtFrame}
        durationInFrames={durationInFrames}
        envelope={envelope}
        stroke={stroke}
        strokeWidth={strokeWidth}
        dashArray={dashArray}
        dashGap={dashGap}
        drawDurationFraction={drawDurationFraction}
        rotateDashes={rotateDashes}
      />
    );
  }

  if (!bounds) return null;

  const cfg = mergeCfg({ inset, stroke, strokeWidth, dashArray, dashGap, rx, drawDurationFraction, rotateDashes });

  const x = bounds.x - cfg.inset;
  const y = bounds.y - cfg.inset;
  const width = Math.max(0, bounds.width + cfg.inset * 2);
  const height = Math.max(0, bounds.height + cfg.inset * 2);
  const perimeter = 2 * (width + height);
  const r = Math.min(cfg.rx, width / 2, height / 2);
  // Rounded-rect path (not a plain <rect>) so it shares the same masked-dash
  // draw-on renderer as the silhouette polygon path — one code path, one
  // reveal technique, for both bbox and silhouette modes.
  const d =
    `M${x + r},${y} ` +
    `H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} ` +
    `V${y + height - r} A${r},${r} 0 0 1 ${x + width - r},${y + height} ` +
    `H${x + r} A${r},${r} 0 0 1 ${x},${y + height - r} ` +
    `V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;

  const { drawFrames, drawProgress } = drawWindow(cfg, frame, enterAtFrame, exitAtFrame, durationInFrames);
  const crawl = crawlOffset(cfg, drawProgress, frame, enterAtFrame, drawFrames);

  return <MaskedDashPath d={d} length={perimeter} drawProgress={drawProgress} crawl={crawl} cfg={cfg} envelope={envelope} />;
}

export default BoundaryDrawer;
