import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from "remotion";
import HighlighterOverlay from "../_shared/highlighter.jsx";

/**
 * TextEmerge — a cinematic, b-roll-weight sibling of KineticText.
 *
 * KineticText's per-word spring is a snappy overshoot "pop" — great for
 * caption-style beats synced tight to narration. TextEmerge is the opposite
 * taste: text MATERIALIZES. Each word fades up out of a soft blur on a
 * slow, monotonic ease (no overshoot, no bounce) while the whole block
 * gets one coordinated lift+scale so it reads as a single mass drifting
 * into frame rather than a sequence of individual pops. Built for
 * standalone b-roll title/statement cards (see
 * scripts/curate/solutions/composition/b-roll-sequence.md step 7) that
 * need more weight than a plain TextBlock fade-up but none of
 * KineticText's caption energy.
 *
 * Same two timing modes as KineticText, decided the same way by pipeline2
 * (resolve.js):
 *  - NARRATION-SYNCED (timing.words present): word N materializes at the
 *    real frame WhisperX measured it being spoken.
 *  - EVEN STAGGER (timing.words absent): words materialize on a fixed
 *    cadence (resolvedStyle.staggerFrames), auto-compressed so the whole
 *    line always resolves before exitAtFrame.
 *
 * Exit mirrors the entrance instead of KineticText's flat opacity fade:
 * the block softens into blur and drifts further along its arrival axis
 * as it fades, so it leaves with the same "dissolve" quality it arrived
 * with rather than cutting out.
 *
 * Same live-DOM wrap measurement as KineticText for the optional inline
 * HighlighterOverlay — see that component's docstring for the geometry
 * contract.
 */

const EASE_CURVES = {
  // No overshoot on any of these — deliberately monotonic 0->1, the
  // "less pop, more appear" ask. Pick a curve by name via
  // resolvedStyle.easing (a plain string, NOT a spring config — TextEmerge
  // doesn't use remotion's spring() at all).
  easeOutCubic: Easing.bezier(0.215, 0.61, 0.355, 1),
  easeOutQuart: Easing.bezier(0.25, 1, 0.5, 1),
  easeOutExpo: Easing.bezier(0.16, 1, 0.3, 1),
};

function resolveEase(name) {
  return EASE_CURVES[name] ?? EASE_CURVES.easeOutExpo;
}

// direction -> unit vector words drift FROM on the way in (mirrors
// motion.js's DIRECTION_OFFSETS convention: "up" starts below and rises).
const DRIFT_VECTORS = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
};

export function TextEmerge({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  useVideoConfig(); // kept for parity with sibling text assets; no spring() here to read fps from
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames, words: wordTimings } = timing;

  const words = (content.text ?? "").trim().split(/\s+/).filter(Boolean);

  // NOTE: intentionally NOT named "easing" — the framework's global style
  // resolver (src/registry/styleRegistry.js resolveAssetStyle) treats any
  // style key literally named "easing" as a reserved spring-config token
  // lookup against styles.easing (e.g. "snappySpring" -> {damping,mass,
  // stiffness}), which would collide with this asset's plain named-curve
  // strings ("easeOutExpo" etc.) and throw "Unknown easing token" at
  // resolve. "curve" sidesteps that reserved key entirely.
  const ease = resolveEase(resolvedStyle.curve);
  const requestedStagger = resolvedStyle.staggerFrames ?? 8;
  const revealDurationFrames = resolvedStyle.revealDurationFrames ?? 26;
  const driftDistance = resolvedStyle.driftDistance ?? 34;
  const driftDirection = DRIFT_VECTORS[resolvedStyle.driftDirection] ? resolvedStyle.driftDirection : "up";
  const dir = DRIFT_VECTORS[driftDirection];
  const blurAmount = resolvedStyle.blurAmount ?? 16;
  const scaleFrom = resolvedStyle.scaleFrom ?? 0.985;

  const hasWordTimings = Array.isArray(wordTimings) && wordTimings.length === words.length;

  // Same auto-compression idea as KineticText's stagger, budgeted a little
  // looser (0.7 vs 0.6) because a slow materialize reads best when the
  // cascade still has room to breathe before the hold.
  const revealBudgetFrames = Math.max(1, (exitAtFrame - enterAtFrame) * 0.7);
  const effectiveStagger =
    words.length > 1 ? Math.min(requestedStagger, revealBudgetFrames / (words.length - 1)) : 0;

  // ---- container-level arrival: the whole block lifts + scales up as ONE
  // coordinated motion, decoupled from the per-word cascade beneath it, so
  // the block reads as a single mass drifting into frame instead of two
  // competing motions.
  const containerLift = resolvedStyle.containerLift ?? true;
  const containerDriftDistance = resolvedStyle.containerDriftDistance ?? 26;
  const containerScaleFrom = resolvedStyle.containerScaleFrom ?? 0.975;
  const containerWindow = Math.min(revealDurationFrames + 6, Math.max(1, exitAtFrame - enterAtFrame));
  const containerProgress = interpolate(frame, [enterAtFrame, enterAtFrame + containerWindow], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const containerEased = ease(containerProgress);
  const containerScale = containerLift ? interpolate(containerEased, [0, 1], [containerScaleFrom, 1]) : 1;
  const containerTranslateY = containerLift
    ? interpolate(containerEased, [0, 1], [containerDriftDistance * dir.y, 0])
    : 0;
  const containerTranslateX = containerLift
    ? interpolate(containerEased, [0, 1], [containerDriftDistance * dir.x, 0])
    : 0;

  // ---- exit: dissolve, not a hard cut. Mirrors the arrival — blur +
  // drift-further-along-the-arrival-axis while fading, so the exit reads
  // as a continuation of the same "materialize" language instead of a
  // separate flat fade like KineticText's exitOpacity.
  const exitWindow = Math.min(24, durationInFrames * 0.2);
  const framesUntilExit = exitAtFrame - frame;
  const holdFraction = interpolate(framesUntilExit, [0, exitWindow], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exitEased = ease(1 - holdFraction); // 0 while held, ->1 as it leaves
  const exitOpacity = 1 - exitEased;
  const exitBlur = exitEased * blurAmount * 0.6;
  const exitTranslateX = exitEased * driftDistance * 0.5 * dir.x;
  const exitTranslateY = exitEased * driftDistance * 0.5 * dir.y;

  const justify =
    resolvedStyle.align === "center" ? "center" : resolvedStyle.align === "right" ? "flex-end" : "flex-start";

  const contentWidth = resolvedStyle.width ?? 1500;
  const fontSize = resolvedStyle.typography?.fontSize ?? 96;
  const lineHeight = resolvedStyle.typography?.lineHeight ?? 1.12;

  // ---- live wrap measurement for the highlighter overlay (identical
  // approach to KineticText — see that file's docstring for the rationale).
  const wrapRef = React.useRef(null);
  const [lineBoxes, setLineBoxes] = React.useState(null);
  React.useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const spans = wrap.querySelectorAll("[data-word]");
    const boxes = [];
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      boxes.push({
        top: el.offsetTop,
        left: el.offsetLeft,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
    }
    setLineBoxes(boxes);
  }, [words.join(" "), contentWidth]);

  const wordSpans = words.map((word, i) => {
    const wordStartFrame = hasWordTimings
      ? Math.max(enterAtFrame, Math.min(wordTimings[i].startFrame, exitAtFrame))
      : enterAtFrame + i * effectiveStagger;

    // Plain interpolate (not spring): monotonic materialize, no overshoot.
    // extrapolateLeft: "clamp" gives us the "fully hidden before its turn"
    // state for free — no separate branch needed like KineticText's spring
    // path required.
    const localProgress = interpolate(frame, [wordStartFrame, wordStartFrame + revealDurationFrames], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const eased = ease(localProgress);

    const opacity = eased;
    const blurPx = (1 - eased) * blurAmount;
    const translateX = (1 - eased) * driftDistance * dir.x;
    const translateY = (1 - eased) * driftDistance * dir.y;
    const scale = interpolate(eased, [0, 1], [scaleFrom, 1]);

    return (
      <span
        key={`${word}-${i}`}
        data-word={i}
        style={{
          display: "inline-block",
          opacity,
          filter: blurPx > 0.05 ? `blur(${blurPx}px)` : "none",
          transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        }}
      >
        {word}
      </span>
    );
  });

  return (
    <div
      style={{
        ...resolvedPosition,
        width: contentWidth,
        opacity: exitOpacity,
        filter: exitBlur > 0.05 ? `blur(${exitBlur}px)` : "none",
        transform: `translate(${containerTranslateX + exitTranslateX}px, ${
          containerTranslateY + exitTranslateY
        }px) scale(${containerScale})`,
      }}
    >
      <div
        ref={wrapRef}
        style={{
          position: "relative",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: justify,
          gap: "0.12em 0.4em",
          fontFamily: resolvedStyle.typography?.fontFamily,
          fontSize: resolvedStyle.typography?.fontSize,
          fontWeight: resolvedStyle.typography?.fontWeight,
          lineHeight: resolvedStyle.typography?.lineHeight,
          color: resolvedStyle.typography?.color,
          background: resolvedStyle.backgroundColor ?? "transparent",
        }}
      >
        <HighlighterOverlay
          frame={frame}
          enterAtFrame={enterAtFrame}
          exitAtFrame={exitAtFrame}
          durationInFrames={durationInFrames}
          envelope={1}
          lineBoxes={lineBoxes}
          size={{ width: contentWidth, height: Math.round(fontSize * lineHeight) }}
          highlighter={resolvedStyle.highlighter}
        />
        {wordSpans}
      </div>
    </div>
  );
}
