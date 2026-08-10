import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import HighlighterOverlay from "../_shared/highlighter.jsx";

/**
 * Reveals `content.text` one word at a time. Unlike TextBlock (which animates
 * as a single unit), each word gets its own pop-in spring.
 *
 * Two timing modes, chosen automatically by pipeline2 (resolve.js):
 *
 *  - NARRATION-SYNCED (timing.words present): wired in only when this
 *    asset's content.text is word-for-word identical to the scene's
 *    narration text, so it's unambiguous which spoken word is which. Each
 *    word pops at the real frame WhisperX measured it being spoken (clamped
 *    to not start before enterAtFrame), so the caption reads in lockstep
 *    with the voiceover instead of an artificial cadence.
 *
 *  - EVEN STAGGER (timing.words absent): the original behavior. Words pop on
 *    a fixed resolvedStyle.staggerFrames cadence, auto-compressed against
 *    the asset's actual timing budget so word count * stagger never runs
 *    past exitAtFrame. Used when there's no narration, the text doesn't
 *    match narration verbatim, or the author sets
 *    styleOverride.useNarrationTiming: false.
 *
 * Text wrapping is measured live from the DOM (useLayoutEffect) so the
 * optional inline HighlighterOverlay can fit itself over the ACTUAL wrapped
 * text geometry — covering every wrapped line and following the sweep onto
 * each new line as words break across them, instead of only ever painting
 * the first line. Hidden (not-yet-popped) word spans keep their layout slot
 * (display:inline-block + opacity:0), so the wrap is stable from the first
 * commit: we measure once on mount and reuse the result every frame.
 */
export function KineticText({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames, words: wordTimings } = timing;

  const words = (content.text ?? "").trim().split(/\s+/).filter(Boolean);
  const requestedStagger = resolvedStyle.staggerFrames ?? 6;

  // Snappier spring configuration for pop-in effects
  const easingConfig = resolvedStyle.easing ?? { damping: 15, mass: 0.2, stiffness: 300 };
  const popScale = resolvedStyle.wordPopScale ?? 1.2;

  const hasWordTimings = Array.isArray(wordTimings) && wordTimings.length === words.length;

  const revealBudgetFrames = Math.max(1, (exitAtFrame - enterAtFrame) * 0.6);
  const effectiveStagger =
    words.length > 1 ? Math.min(requestedStagger, revealBudgetFrames / (words.length - 1)) : 0;

  const framesUntilExit = exitAtFrame - frame;
  const exitOpacity = interpolate(framesUntilExit, [0, Math.min(15, durationInFrames * 0.15)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const justify =
    resolvedStyle.align === "center" ? "center" : resolvedStyle.align === "right" ? "flex-end" : "flex-start";

  const contentWidth = resolvedStyle.width ?? 1100;
  const fontSize = resolvedStyle.typography?.fontSize ?? 84;
  const lineHeight = resolvedStyle.typography?.lineHeight ?? 1.1;

  // ---- live wrap measurement for the highlighter overlay ---------------------
  // Each word span is tagged data-word; after mount we read offsetTop/Left/
  // Width/Height (relative to the position:relative wrapper) and group words
  // into the lines the browser actually wrapped to. This makes the
  // highlighter follow the real wrapped geometry instead of guessing one
  // line box. Empty deps → measure once after first commit; the wrap is
  // frame-independent because hidden words still reserve their layout slot.
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
    // Re-measure only when the text content (or its container width that
    // drives the wrap) changes — not on every frame.
  }, [words.join(" "), contentWidth]);

  const wordSpans = words.map((word, i) => {
    const wordStartFrame = hasWordTimings
      ? Math.max(enterAtFrame, Math.min(wordTimings[i].startFrame, exitAtFrame))
      : enterAtFrame + i * effectiveStagger;

    // Keep word completely hidden until its frame arrives
    if (frame < wordStartFrame) {
      return (
        <span
          key={`${word}-${i}`}
          data-word={i}
          style={{ display: "inline-block", opacity: 0 }}
        >
          {word}
        </span>
      );
    }

    // Snap animation: starts slightly oversized and quickly snaps down to scale 1.0
    const progress = spring({ frame: frame - wordStartFrame, fps, config: easingConfig });
    const scale = interpolate(progress, [0, 1], [popScale, 1], {
      extrapolateRight: "clamp",
    });

    return (
      <span
        key={`${word}-${i}`}
        data-word={i}
        style={{
          display: "inline-block",
          opacity: 1,
          transform: `scale(${scale})`,
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
      }}
    >
      <div
        ref={wrapRef}
        style={{
          position: "relative",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: justify,
          gap: "0.1em 0.35em",
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
          // envelope=1 decouples the marker opacity from the host's enter/exit
          // fade so the highlight sweeps in then HOLDS at cfg.opacity, rather
          // than fading in/out with the text asset's envelope.
          envelope={1}
          lineBoxes={lineBoxes}
          // size is the legacy single-box fallback used only when lineBoxes
          // is unavailable (kept so the helper still renders something on a
          // first paint before the layout effect commits, and for any host
          // that only passes `size`).
          size={{ width: contentWidth, height: Math.round(fontSize * lineHeight) }}
          highlighter={resolvedStyle.highlighter}
        />
        {wordSpans}
      </div>
    </div>
  );
}
