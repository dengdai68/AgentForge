# Application icons

`application.png` is the unmodified 1254×1254 owner-supplied master (SHA-256 `46bb3c5165723bba5f63f070de19647fa6c6385366579d0d9a9a9bb1277e937e`). Never overwrite or redraw it.

Generate all committed presentation assets on macOS:

```sh
node scripts/build-app-icon.cjs
```

- `application-ui.png`: 1024px clean rounded tile for the sidebar. Clips detached edge pixels and composites partial alpha over a dark matte; no white plate, stroke or CSS frame.
- `application-dock.png`: the same tile at 824px, centred in a transparent 1024px canvas (100px inset on each edge), used by the running Dock and BrowserWindow.
- `apps/electron/application.icns`: native sizes generated from that inset Dock asset, so Finder/installation and the running app have the same visual scale.
- `trayTemplate.png` / `trayTemplate@2x.png`: 18/36px black-and-alpha A silhouettes without the coloured tile. Electron loads them as a native template. macOS renders white on dark menu bars and dark on light menu bars, including selected/disabled appearances. Do not force white or use the full tile as an alpha mask.

The existing optional build script uses the macOS Swift/AppKit/CoreGraphics/ImageIO tools and sips/iconutil, with a private temporary directory; no browser, network, package dependency or operator configuration is involved. Commit regenerated assets together. The menu-bar silhouette is authored in the generator for legibility at 18pt; the coloured mark remains the supplied master.

The `vscode/` subset has its own source and license.

Validation: source and packaged Electron presentation checks cover both application themes at 1320px and 760px, transparent corners, opaque coloured edge pixels, absence of CSS frames, a square sidebar image, native template recognition with 1x/2x representations, and exact Dock alpha bounds `(100,100)–(924,924)`. No CLI/API or task execution protocol changes. System menu-bar colours are owned by macOS, not by renderer theme settings.
