# Token vs literal

Every visual property (color, typography, easing) can be:

1. A **token** string (`"shade1"`, `"heading1"`, `"gentleSpring"`) — the
   default path. The token resolves against `styles/theme.json`. Change
   the token's value in one place, every scene using it updates.
2. A **literal** value (`"#112233"`) — rare, one-off escape hatch.

This is what keeps a whole video visually coherent instead of looking like
each slide was styled independently. Prefer tokens. Use literals only for
genuinely one-off cases that have no reason to share a definition.

Resolution is centralized in `src/registry/styleRegistry.js`:
`resolveColorToken`, `resolveTypographyToken`, `resolveEasingToken`,
`resolveAssetStyle`. Unknown tokens throw listing the known ones — you
can't silently typo a token into a wrong color.
