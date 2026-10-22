# Drape — Virtual Shirt Studio

Upload one photo, confirm the shirt once, then switch shirt colours and prints
instantly on that same photo — like a live filter. Everything runs in the
browser: no AI image generation, no uploads, no account.

## Run it

Requires Node.js 20+ (tested on Node 24).

```bash
npm install          # also copies the MediaPipe WASM runtime and downloads the two models into /public
npm run dev          # http://localhost:3000
```

Production:

```bash
npm run build
npm start            # http://localhost:3000
```

To test on an iPhone, run the server on your computer and open
`http://<your-computer's-LAN-IP>:3000` in Safari on the same Wi-Fi.

Checks:

```bash
npm run typecheck    # TypeScript (strict)
npm run lint         # ESLint (next/core-web-vitals + typescript)
npm test             # Vitest unit tests for the image-processing code
```

Add `?debug=1` to the URL to expose `window.__drape` (render timing and pixel
readback) for automated testing.

## How it works

1. **Photo & frame** — JPG/PNG/WebP/HEIC (HEIC is decoded natively on Safari;
   other browsers convert it locally with `heic2any`). Crop, rotate, straighten,
   zoom and reposition. The working photo is capped at 1600 px on the long edge.
2. **Shirt detection** (`src/lib/segmentation.ts`)
   - MediaPipe **multiclass selfie segmenter** (Apache-2.0) gives a per-pixel
     "clothes" probability plus face/hair/skin probabilities.
   - MediaPipe **pose landmarker** locates the hips; colour statistics above and
     below the hips separate the shirt from trousers (the segmenter calls both
     "clothes").
   - Stray blobs are dropped, small enclosed gaps (buttons) are filled, and a
     **colour-guided filter** snaps the 256 px model output to the photo's real
     edges. Face, hair and skin are explicitly protected.
   - If detection finds nothing or the models can't load, the app says so and
     the manual tools take over — it never fakes a result.
3. **Mask editing** — Brush (add), Erase, Restore (paint back the automatic
   selection), and Magic select (tap to add connected, similar-coloured fabric).
   Undo/redo, pinch/scroll zoom, two-finger pan.
4. **Studio** (`src/lib/renderer.ts`) — a WebGL shader composites the pattern
   onto the shirt only. The photo, mask and shading maps are uploaded once;
   switching patterns swaps one cached texture and redraws a single quad. The
   original shirt's luminance (fine detail + large folds) shades the new
   pattern in linear light, and the pattern bends slightly along folds. Pixels
   outside the mask output the original bytes exactly.

5. **Live camera** (`src/lib/live.ts`) — point the phone at him and the shirt
   changes on the live video, like a filter. Each frame is drawn immediately
   with the latest mask; detection (GPU-delegated MediaPipe, falling back to
   CPU) runs after the paint on an adaptive budget so the video stays smooth on
   slower devices. Masks are blended over time to avoid flicker. **Capture**
   freezes a frame and sends it through the full-quality pipeline above
   (sharp edges, touch-up, save). The camera needs HTTPS (or localhost). Add
   `?debug=1` to see the measured detector speed on screen.

Patterns (`src/lib/patterns.ts`) are drawn procedurally into seamless 512 px
tiles: 8 solids + any colour, stripes, checks & plaid, geometric, floral,
festive (paisley, bandhani, block print, mandala, ikat, zari) and small motifs.
You can also upload your own fabric/print (optional plain-background removal and
mirrored seamless repeat).

## Privacy

- The photo and camera feed are processed only in the browser; camera frames
  are never recorded or uploaded, and the camera is switched off when you
  leave the live view.
- The photo is processed only in the browser. Only the model files are
  downloaded (served from this app's own `/public`; if they are missing the app
  falls back to Google's public model URLs — still no photo is sent).
- Nothing is stored unless you switch on **Keep on this device** (IndexedDB in
  this browser only). **Remove photo & start over** deletes it.

## Project layout

```
src/app/                 Next.js App Router entry, layout, global styles
src/components/          Upload, Crop, Mask, Studio screens; Viewport (zoom/pan/draw); UI
src/lib/segmentation.ts  Detection pipeline (MediaPipe + guided filter)
src/lib/renderer.ts      WebGL try-on renderer
src/lib/patterns.ts      Procedural pattern library + custom print tiles
src/lib/mask.ts          Brush, magic select, hole filling, components
src/lib/guidedFilter.ts  Box / guided filters (grey and colour guide)
src/lib/crop.ts          Crop geometry shared by preview and output
src/lib/history.ts       Undo/redo with live (uncommitted) edits
src/lib/storage.ts       Opt-in IndexedDB session
scripts/                 postinstall: copy WASM runtime, fetch models
tests/                   Vitest unit tests
```

## Known limitations

- Detection quality depends on the photo: jackets over shirts, very loose
  kurtas, heavy occlusion or several people may need manual touch-up.
  When top and trousers are the same colour, the hem is estimated just below
  the hips.
- Shading is derived from the original shirt. A strongly printed original can
  ghost through; lower **Fabric detail** to reduce it.
- The new pattern bends gently with large folds but is not a 3D cloth
  simulation; sleeves keep the same pattern direction as the body.
- Custom prints are cropped to a centred square tile.
- Live mode edges are softer than the captured photo's, and the mask trails
  fast movement slightly. Live speed depends on the phone's GPU: on the 2017
  Intel laptop GPU used for testing, one detection update took ~150 ms;
  modern iPhones are expected to be faster but this has not been measured.
