// Keep the owner-supplied master untouched; build purpose-specific app assets.
// CoreGraphics clips the tile edge and gives macOS its own transparent inset.
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFileSync } = require('node:child_process');

  async function build() {
    if (process.platform !== 'darwin') throw new Error('Icon generation requires macOS iconutil; generated assets are committed.');
    const scratch = await mkdtemp(join(tmpdir(), 'agentforge-icon-'));
    try {
      const png = resolve('web/icons/application.png');
      const source = await readFile(png);
      if (source.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || source.readUInt32BE(16) !== source.readUInt32BE(20) || source.readUInt32BE(16) < 1024) throw new Error('Application icon must be a square PNG of at least 1024px.');
      const renderer = join(scratch, 'render.swift');
      await writeFile(renderer, `
import AppKit
import ImageIO
import UniformTypeIdentifiers
let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let input = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(input, 0, nil) else { fatalError("Cannot decode application master") }
func render(_ name: String, _ size: Int, _ paint: (CGContext) -> Void) {
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.interpolationQuality = .high
    paint(context)
    let destination = CGImageDestinationCreateWithURL(output.appendingPathComponent(name) as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Cannot encode icon") }
}
func tile(_ context: CGContext, _ rect: CGRect) {
    context.saveGState()
    context.addPath(CGPath(roundedRect: rect, cornerWidth: rect.width * 0.205, cornerHeight: rect.height * 0.205, transform: nil))
    context.clip()
    // Keep the complete supplied composition inside the standard rounded tile.
    // The matte only fills any transparency in the owner-supplied source.
    context.setFillColor(CGColor(srgbRed: 0.02, green: 0.04, blue: 0.16, alpha: 1))
    context.fill(rect)
    context.draw(image, in: rect)
    context.restoreGState()
}
render("application-ui.png", 1024) { tile($0, CGRect(x: 0, y: 0, width: 1024, height: 1024)) }
render("application-dock.png", 1024) { tile($0, CGRect(x: 100, y: 100, width: 824, height: 824)) }
// A monochrome, open-counter A silhouette for the menu bar. A template must
// omit the coloured tile: its alpha alone is what macOS draws and inverts.
for scale in [1, 2] {
    render(scale == 1 ? "trayTemplate.png" : "trayTemplate@2x.png", 18 * scale) { c in
        c.scaleBy(x: CGFloat(scale) * 0.75, y: -CGFloat(scale) * 0.75)
        c.translateBy(x: 0, y: -24)
        let p = CGMutablePath()
        p.move(to: CGPoint(x: 4, y: 22))
        p.addCurve(to: CGPoint(x: 1.5, y: 17.4), control1: CGPoint(x: 1.5, y: 22), control2: CGPoint(x: 0.3, y: 19.7))
        p.addLine(to: CGPoint(x: 8.3, y: 4.3))
        p.addCurve(to: CGPoint(x: 10.7, y: 3), control1: CGPoint(x: 8.9, y: 3.1), control2: CGPoint(x: 9.6, y: 3))
        p.addLine(to: CGPoint(x: 13.4, y: 3))
        p.addCurve(to: CGPoint(x: 15.9, y: 4.8), control1: CGPoint(x: 14.6, y: 3), control2: CGPoint(x: 15.3, y: 3.6))
        p.addLine(to: CGPoint(x: 22.5, y: 17.6))
        p.addCurve(to: CGPoint(x: 20, y: 22), control1: CGPoint(x: 23.6, y: 19.8), control2: CGPoint(x: 22.5, y: 22))
        p.addLine(to: CGPoint(x: 17.8, y: 22))
        p.addCurve(to: CGPoint(x: 15.5, y: 20.5), control1: CGPoint(x: 16.7, y: 22), control2: CGPoint(x: 16.1, y: 21.5))
        p.addLine(to: CGPoint(x: 13.8, y: 17.4))
        p.addLine(to: CGPoint(x: 11.7, y: 20.8))
        p.addCurve(to: CGPoint(x: 9.5, y: 22), control1: CGPoint(x: 11.2, y: 21.6), control2: CGPoint(x: 10.5, y: 22))
        p.closeSubpath()
        p.move(to: CGPoint(x: 9.3, y: 14.5))
        p.addLine(to: CGPoint(x: 15.6, y: 14.5))
        p.addLine(to: CGPoint(x: 12.4, y: 8.7))
        p.closeSubpath()
        c.addPath(p); c.setFillColor(CGColor(gray: 0, alpha: 1)); c.drawPath(using: .eoFill)
    }
}
`);
      execFileSync('/usr/bin/swift', [renderer, png, resolve('web/icons')], { stdio: 'inherit' });
      const iconset = join(scratch, 'application.iconset'); await mkdir(iconset);
      for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
        execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), resolve('web/icons/application-dock.png'), '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
      }
      execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', resolve('apps/electron/application.icns')]);
      console.log('Generated clean UI tile, inset Dock/ICNS and 1x/2x menu-bar templates; application.png unchanged');
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
  build().catch(error => { console.error(error); process.exitCode = 1; });
