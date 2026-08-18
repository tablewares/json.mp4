     
## patterns
use these instead of just fractional values
```json
"enterAt": {
"relativeToAsset": "ImageReveal-1",
"offsetFrames": 10
},
"enterAt": {

"relativeToWord": ["computers", "agreeing"],
"offsetFrames": -2
},
```
## rendering
```bash
npm run build -- studio/manifest/<project-id>/manifest.json

node scripts/agent-cli.mjs render <project-id>
```

## Rules
- time assets one after another, never enterAt on all assets all at the same time if using multiple.
- pexels/index.js should only be for stock b roll videos and images and basic objects.
- scripts/agent-cli.mjs collections should only be for images of people and  more specific objects. 


