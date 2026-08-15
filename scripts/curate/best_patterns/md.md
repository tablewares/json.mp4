     
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
build or agent cli render

```bash
npm run build -- studio/manifest/<project-id>/manifest.json

node scripts/agent-cli.mjs render <project-id>
```
## b roll
use pexels for stock footage.
use agent-cli.mjs collection for specific images, like people or places.

##