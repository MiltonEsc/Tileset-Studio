# SpriteCook Tileset Base Generator

Vendored from https://github.com/SpriteCook/spritecook-tileset-gen

- Branch: `master`
- Source file commit/blob SHA: `6565abc8518d862988adba6747c138c75a5e2b50`
- License: MIT; see `LICENSE` in this directory.

`index.html` remains as the standalone reference editor and includes two local,
clearly scoped extensions: the elevation-edge controls (`Elevation edge` +
`Elevation depth`) and the `Platform 47+1` Blob-47 layout used by Tileset
Studio's 8 x 6 tilesheets.

Tileset Studio now runs a native React port of the complete generator in
`src/core/spriteCookBaseGenerator.js` and
`src/components/SpriteCook/SpriteCookWorkspace.jsx`. It preserves all upstream
geometry, texture, color, seed, grid, background and export controls while
adding the app-native capture, GPT Image coloring, library and level-editor
pipeline. The vendored standalone copy and MIT license are retained for source
provenance and comparison.
