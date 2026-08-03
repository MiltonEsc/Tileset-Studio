# SpriteCook Tileset Base Generator

Vendored from https://github.com/SpriteCook/spritecook-tileset-gen

- Branch: `master`
- Source file commit/blob SHA: `6565abc8518d862988adba6747c138c75a5e2b50`
- License: MIT; see `LICENSE` in this directory.

`index.html` keeps the standalone upstream editor and adds a local, clearly
scoped elevation-edge control (`Elevation edge` + `Elevation depth`). Tileset
Studio embeds it in a same-origin iframe and performs capture, GPT Image
coloring, storage, and level-editor integration in the parent application.
