import React from "react";
import { SvgStage, Bar, Text, LinearGradient, Glow, useRevealContext } from "../../../src/svg/index.jsx";

/**
 * GlowBar — the first asset authored natively on the SVG substrate.
 *
 * A single animated progress bar that grows left->right, a glow halo behind
 * it, an optional percentage label that counts up alongside the fill, and a
 * thin track the fill rides. This is the "money counting up / KPI charging"
 * move that a flat div literally cannot express without fake hacks.
 *
 * content:  { value: 0..100, label?: string }
 * style:    valueFill (hex), trackColor (hex), labelFill (hex),
 *           lineHeight (px, thickness of the bar), glowStrength (px),
 *           gradient { from,to,angle } (raw hex literals, optional),
 *           showLabel (bool, default true), suffix (string, default "%")
 *
 * All frame/pacing math lives in the substrate's useReveal; this component
 * only composes geometry and reads `reveal` for the fill + the count-up.
 */
export function GlowBar({ resolvedPosition, resolvedStyle, content, timing }) {
  const width = Math.max(1, Number(resolvedStyle.width ?? 720));
  const height = Math.max(1, Number(resolvedStyle.height ?? 96));
  const value = Math.max(0, Math.min(100, Number(content.value ?? 0)));
  const showLabel = resolvedStyle.showLabel ?? true;
  const suffix = resolvedStyle.suffix ?? "%";
  const label = content.label ?? "";

  const trackFill = resolvedStyle.trackFill ?? "#161B26";
  const labelFill = resolvedStyle.labelFill ?? "#F5F7FA";
  const lineHeight = Math.max(2, Number(resolvedStyle.lineHeight ?? 28));
  const glowStrength = Number(resolvedStyle.glowStrength ?? 10);
  const gradient = resolvedStyle.gradient ?? { from: "#3D7BFD", to: "#C04CFD", angle: 0 };

  // We need reveal *and* the exit path; the stage already binds reveal in
  // context, but the count-up value text wants the same number, so read it
  // from context to stay consistent with the bar's fill.
  const ctx = useRevealContext();
  const reveal = ctx.reveal;

  const barY = (height - lineHeight) / 2;
  const barX = 0;
  const fullBarW = width;
  const fillW = fullBarW * (value / 100) * reveal;
  
  const displayValue = Math.round(value * reveal);

  return (
    <SvgStage resolvedPosition={resolvedPosition} resolvedStyle={resolvedStyle} timing={timing} content={content}>
      <LinearGradient id="gb-grad" from={gradient.from} to={gradient.to} angle={gradient.angle} />
      {glowStrength > 0 ? <Glow id="gb-glow" strength={glowStrength} color={gradient.from} /> : null}

      {/* track — static, sits at low opacity behind the fill */}
      <rect x={barX} y={barY} width={fullBarW} height={lineHeight} rx={lineHeight / 2} fill={trackFill} opacity={Math.min(1, reveal * 2)} />

      {/* fill — draws left->right, masked via width=fillW (drop-in <Bar grow="right">) */}
      <Bar
        x={barX}
        y={barY}
        width={fullBarW * (value / 100)}
        height={lineHeight}
        rx={lineHeight / 2}
        fill="url(#gb-grad)"
        grow="right"
        reveal={reveal}
        style={{ filter: glowStrength > 0 ? "url(#gb-glow)" : undefined }}
      />

      {/* label + count-up */}
      {showLabel ? (
        <>
          {label ? (
            <Text x={0} y={barY - 16} text={label} fill={labelFill} fontSize={28} fontWeight={600} />
          ) : null}
          <Text
            x={fullBarW + 8}
            y={barY + lineHeight * 0.72}
            text={`${displayValue}${suffix}`}
            fill={labelFill}
            fontSize={lineHeight * 0.9}
            fontWeight={700}
            anchor="start"
          />
        </>
      ) : null}
    </SvgStage>
  );
}

export default GlowBar;
