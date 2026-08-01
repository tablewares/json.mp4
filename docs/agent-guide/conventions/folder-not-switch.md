# Folder, not switch statement

Assets and transitions are discovered by scanning folders at resolve
time — there is no registry of `if assetType === ...` branches.

```
src/assets/<AssetName>/manifest.json   <- declares accepted schemas + defaults
src/assets/<AssetName>/<AssetName>.jsx <- the component

src/transitions/<Name>/manifest.json
src/transitions/<Name>/<Name>.jsx
```

New visual = new folder. `src/registry/assetRegistry.js` `scanFolder`
walks the dir, loads each `manifest.json`, keys by folder name. Nothing
is hardcoded into the renderer.

Why: the framework stays open for extension without a core code edit.
Adding an asset or transition is purely additive — drop a folder, update
the docs table. Removing one is purely subtractive.
