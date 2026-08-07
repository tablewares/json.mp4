// Single-project build script — uses agent-project-interface.js library exports
// (createProject / createScene / createAsset) to author ONE project, then the
// CLI `render` mode will render it. No batch mode — single project only.
import { createProject, createScene, createAsset } from './agent-project-interface.js';

const projectDir = './studio/manifest/agent-build';

// Clone the richest existing look (8 colors, 5 typography tokens, both springs)
// so easing tokens used by asset manifests resolve correctly.
createProject({
  projectId: 'agent-build',
  projectDir,
  cloneThemeFrom: 'legacy/packet-journey',
  cloneConfigFrom: 'legacy/packet-journey',
  config: { defaultSceneDurationInFrames: 180 }, // 6s @ 30fps
  theme: { typography: { heading1: { fontSize: 96 } } },
});

// One scene, three validated assets (schemas inspected, not guessed).
createScene({
  projectDir,
  sceneId: 'scene-open',
  scene: { background: 'shade2' },
});

createAsset({
  projectDir,
  sceneId: 'scene-open',
  asset: {
    id: 'headline',
    assetType: 'KineticText',
    anchor: { position: 'top-left', offsetXPercent: 6, offsetYPercent: 8 },
    contentOverride: { text: 'Markets this quarter rolled higher on broad-based strength.' },
    styleOverride: { typography: 'heading1', align: 'left', wordPopScale: 1.18, staggerFrames: 5 },
    enterAt: 0.0,
    exitAt: 0.9,
  },
});

createAsset({
  projectDir,
  sceneId: 'scene-open',
  asset: {
    id: 'kpi-revenue',
    assetType: 'NumberStat',
    anchor: { position: 'center', offsetYPercent: 6 },
    contentOverride: { value: 4823000000, label: 'Q3 net revenue', fromValue: 0 },
    styleOverride: {
      valueFormat: 'compact', prefix: '$', decimals: 1,
      labelPosition: 'bottom', align: 'center', borderRadius: 28,
      canvasFill: 'shade2', borderLine: 'accentBg',
    },
    enterAt: 0.1,
    exitAt: 0.95,
  },
});

createAsset({
  projectDir,
  sceneId: 'scene-open',
  asset: {
    id: 'tape',
    assetType: 'TickerTape',
    anchor: { position: 'bottom', offsetXPercent: 0, offsetYPercent: -3 },
    contentOverride: {
      tickers: [
        { symbol: 'AAPL', price: 224.31, change: 1.42 },
        { symbol: 'MSFT', price: 421.07, change: -0.86 },
        { symbol: 'NVDA', price: 138.25, change: 6.17 },
        { symbol: 'GOOGL', price: 178.92, change: 0.74 },
      ],
    },
    styleOverride: { typography: 'caption1', width: 1500, trackHeight: 84, scrollPxPerSec: 110 },
    enterAt: 0.08,
    exitAt: 1.0,
  },
});

console.log('BUILT ' + projectDir);
