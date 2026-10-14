# Avatars (hub-avatar.js)

`hub-avatar.js` is generated: do not edit it by hand.

- `avataaars.json`: the Avataaars artwork by Pablo Stanley (MIT, see `LICENSE-avataaars.txt`), converted
  from the `avataaars@2.0.0` npm package's TSX components to SVG templates by `convert.py`
  (`npm pack avataaars@2.0.0`, extract, then `python convert.py package/src/avatar avataaars.json`).
- `custom.js`: parts and colours drawn for this site in the same style (scrubs, white coat, stethoscope,
  surgical cap, kufi, buzz / slick hair, surgical mask, aviators, reading glasses, stubble, goatee,
  tired eyes, ECG / heart / medical-cross graphics).
- `runtime.js`: the browser module (renderer, defaults, editor parts).

Rebuild: `node tools/avatar/build.js tools/avatar/avataaars.json "$PWD/tools/avatar/custom.js" hub-avatar.js`.
When option counts change, update `AVATAR_LIMITS` in `worker/src/accounts.js` (the build prints them).
