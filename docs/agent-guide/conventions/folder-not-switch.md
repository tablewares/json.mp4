# Folder, not switch statement

Assets and transitions are discovered by scanning folders at resolve
time — there is no registry of `if assetType === ...` branches.

```
studio/assets/<AssetName>/manifest.json   <- declares accepted schemas + defaults
studio/assets/<AssetName>/<AssetName>.jsx <- the component

studio/transitions/<Name>/manifest.json
studio/transitions/<Name>/<Name>.jsx
```

New visual = new folder. `src/registry/assetRegistry.js` `scanFolder`
walks the dir, loads each `manifest.json`, keys by folder name. Asset roots
default to `studio/assets` + `studio/graphics`; transition roots default
to `studio/transitions`. Nothing is hardcoded into the renderer.

Why: the framework stays open for extension without a core code edit.
Adding an asset or transition is purely additive — drop a folder, update
the docs table. Removing one is purely subtractive.
