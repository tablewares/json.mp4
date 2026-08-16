// src/registry/externalAdapters.config.js
export const EXTERNAL_ADAPTERS = [
  {
    assetType: "react icons",
    package: "lucide-react",
    description: "react icons",
    defaultSize: { width: 160, height: 160 },
    sizeProp: "size",       // single square-size prop
    colorProp: "color",     // undefined = library ignores color (pre-colored SVG)
    extraProps: { variant: { styleKey: "variant", default: "color" } }, // styleOverride key -> component prop
    // How to turn "Bitcoin" (the export name) into the content key an agent
    // writes ("BTC"). "verbatim" | "upperSnake" | a custom fn.
    keyStrategy: "verbatim",
    ssrSafe: "unverified", // "unverified" | true | false — surfaced as a manifest warning
  },
 
];