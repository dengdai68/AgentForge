# Application icons

`application.png` is the unmodified 1536×1536 owner-supplied master (SHA-256 `530b81a4b34e489a9886d289c27151d1359fa2d8ebc3118c8d3c89adf46f38c9`). Copy a replacement master verbatim only when the owner explicitly supplies a new icon; the generator never rewrites or redraws it.

Generate all committed presentation assets on macOS:

```sh
node scripts/build-app-icon.cjs
```

- `application-ui.png`: 1024px clean rounded tile for the sidebar. Preserves the complete source composition without overscan, clips only the standard rounded corners and composites any transparency over a dark matte; no white plate, stroke or CSS frame.
- `application-dock.png`: the same tile at 824px, centred in a transparent 1024px canvas (100px inset on each edge), used by the running Dock and BrowserWindow.
- `apps/electron/application.icns`: native sizes generated from that inset Dock asset, so Finder/installation and the running app have the same visual scale.
- `trayTemplate.png` / `trayTemplate@2x.png`: 18/36px black-and-alpha A silhouettes without the coloured tile. Electron loads them as a native template. macOS renders white on dark menu bars and dark on light menu bars, including selected/disabled appearances. Do not force white or use the full tile as an alpha mask.

The existing optional build script uses the macOS Swift/AppKit/CoreGraphics/ImageIO tools and sips/iconutil, with a private temporary directory; no browser, network, package dependency or operator configuration is involved. Commit regenerated assets together. The menu-bar silhouette is authored in the generator for legibility at 18pt; the coloured mark remains the supplied master.

The `vscode/` subset has its own source and license.

Validation: `AGENTFORGE_BRAND_ICONS_ONLY=1 node scripts/test-brand-presentation.mjs` runs isolated icon checks; add `AGENTFORGE_BRAND_APP=/absolute/path/AgentForge.app` to target a bundle. Source and packaged Electron icon checks cover both application themes at 1320px and 760px, transparent corners, opaque coloured edge pixels, absence of CSS frames, a square sidebar image, native template recognition with 1x/2x representations, and exact Dock alpha bounds `(100,100)–(924,924)`. No CLI/API or task execution protocol changes. System menu-bar colours are owned by macOS, not by renderer theme settings.
