# Brand — application icon

Two marks, one palette. The **track** is the app's identity: the favicon, the
installed PWA icon, the tile on a runner's home screen. The **42** is a
lettered alternate. Both are here so the mark is versioned rather than living
in someone's downloads folder.

## The track mark

A stadium lane with a single ember lead arc — the runner's position on the
track, which is the one thing the app is for. It survives 16px, which the
numerals do not.

It ships in the app as:

| File in `public/` | Where it shows up |
|---|---|
| `icon.svg` | Browser tab. Follows the browser's colour scheme: clay ground under light chrome, espresso under dark |
| `icon-light-32x32.png`, `icon-dark-32x32.png` | 32px favicon fallbacks, selected by `prefers-color-scheme` in `app/layout.tsx` |
| `apple-icon.png` | iOS home screen, 180px |
| `icon-192.png`, `icon-512.png` | `manifest.json`, installed PWA |
| `icon-maskable-512.png` | Android adaptive icon; the mark is scaled to clear the maskable safe zone |

The favicon and the 32px pair carry a heavier lane and a slightly tighter box
than the large sizes. At 32px the standard stroke thins out and the ember lead
stops registering; the compact geometry keeps both readable.

## What to upload to Strava

For the **42195** entry in a runner's Strava account (Settings → My Apps, and
the OAuth authorisation screen), upload `app-icon-track-light-124.png` at
<https://www.strava.com/settings/api> to match the app icon. Strava asks for a
square PNG or JPG and displays it at 124×124. `app-icon-124.png` — the lettered
`42` mark — is the alternate if the numerals read better beside the app name in
that particular list.

Strava's own brand guidelines forbid using their logo, wordmark or "powered by
Strava" marks inside a third-party app icon, so neither mark carries them.
Strava's orange stays where `PRODUCT.md` puts it: the Connect button in
`components/strava-brand.tsx`, and nowhere else.

## The 42 mark

`42` — the marathon distance the product is named after, rounded to the number a
runner actually says out loud — in Figtree ExtraBold, over an ember lane rule.
Five digits do not survive 124px; two do. The numerals are outlines, not text,
so the SVG needs no webfont to render correctly anywhere.

## Colour

Both marks use the `DESIGN.md` "Tartan" tokens, converted from oklch to sRGB:

| Role | Token | Hex |
|---|---|---|
| Ground (dark) | `--background` dark, lifted | `#241b16` → `#17110e` |
| Ground (light) | `--background` light, lifted | `#e9e2db` → `#ded6ce` |
| Lane / numerals (dark) | `--foreground` dark | `#f0ece7` |
| Lane / numerals (light) | `--foreground` light | `#261b16` |
| Lead arc / rule (dark) | `--primary` dark | `#ef8052` |
| Lead arc / rule (light) | `--primary` light | `#b03105` |

## Files

| File | Use |
|---|---|
| `app-icon-track.svg` | Track mark on espresso, 512 viewBox |
| `app-icon-track-light.*` | Track mark on clay — the ground the app icon uses |
| `app-icon.svg` | The `42` mark on espresso |
| `app-icon-{1024,512,256,124}.png` | Raster exports of the `42` mark |
| `app-icon-light.*` | The `42` mark on clay |

Full-bleed square, no rounded corners baked in — every platform that shows the
icon applies its own corner radius.

## Re-exporting

The PNGs are screenshots of the SVGs at exact pixel sizes; any SVG rasteriser
gives the same result, e.g.

```
rsvg-convert -w 124 -h 124 app-icon-track-light.svg -o app-icon-track-light-124.png
```

After changing anything the service worker caches — `icon.svg` is in its
`STATIC_ASSETS` — bump `CACHE_NAME` in `public/sw.js`, or installed clients keep
serving the old icon forever.
