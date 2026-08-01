# Sprite Fusion Pixel Snapper vendor source

This directory contains the browser/WebAssembly build of
[`Hugo-Dz/spritefusion-pixel-snapper`](https://github.com/Hugo-Dz/spritefusion-pixel-snapper),
licensed under MIT (see `LICENSE`).

- Upstream commit: `ae20461f60fb39e75d15f184bab1ebec1219511c`
- Upstream version: `1.0.0`
- Build command: `wasm-pack build --target web --out-dir <this-directory> --release`

The generated JavaScript and WASM are checked in so Tileset Studio builds with
the normal `npm run build` command and does not require a Rust toolchain.
