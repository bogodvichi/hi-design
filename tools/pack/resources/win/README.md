# Windows app icons

`icon.ico` is the Windows installer, executable, window, and tray icon. Pass
the ICO file path to Electron so Windows can select its native size.

- `icon.png` is the large master: full-canvas rounded black background and
  a centered mark at 72% of the canvas width.
- `icon-16.svg` and `icon-20.svg` are separately
  drawn optical masters. Their node radii, connecting curves, and spacing
  target the named pixel grid. Flat connector fills avoid disappearing
  gradients; smaller middle nodes keep the two center circles separated.
- The ICO contains 16, 20, 24, 32, 40, 48, 64, 128, and 256px RGBA PNG frames.
  Render optical SVGs at 8× their native size, then downsample once with a
  cubic filter. Keep 24px and larger frames rendered from the large master. Do not
  regenerate the small frames by scaling the large master or another frame.

Review small frames at native size against light and dark backgrounds.
Enlarged nearest-neighbor previews reveal coverage pixels; they are not
representative of the native-size appearance.
