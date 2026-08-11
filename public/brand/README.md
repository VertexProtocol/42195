# Brand — application icon

The icon used for the **42195** entry in a runner's Strava account (Settings →
My Apps, and the OAuth authorisation screen). Nothing in the running app renders
these files; they exist so the mark is versioned rather than living in someone's
downloads folder.

## What to upload to Strava

Upload `app-icon-124.png` at <https://www.strava.com/settings/api>. Strava asks
for a square PNG or JPG and displays it at 124×124. `app-icon-256.png` is the
same mark for any surface that renders it larger.

Strava's own brand guidelines forbid using their logo, wordmark or "powered by
Strava" marks inside a third-party app icon, so this mark carries none of them.
Strava's orange stays where `PRODUCT.md` puts it: the Connect button in
`components/strava-brand.tsx`, and nowhere else.

## The mark

`42` — the marathon distance the product is named after, rounded to the number a
runner actually says out loud — in Figtree ExtraBold, over an ember lane rule.
Five digits do not survive 124px; two do, and the app's name sits beside the
icon in every place Strava shows it.

Colours are the `DESIGN.md` "Tartan" tokens converted from oklch to sRGB:

| Role | Token | Hex |
|---|---|---|
| Ground (dark) | `--background` dark, lifted | `#241b16` → `#17110e` |
| Ground (light) | `--background` light, lifted | `#e9e2db` → `#ded6ce` |
| Numerals (dark) | `--foreground` dark | `#f0ece7` |
| Numerals (light) | `--foreground` light | `#261b16` |
| Lane rule (dark) | `--primary` dark | `#ef8052` |
| Lane rule (light) | `--primary` light | `#b03105` |

The numerals are outlines, not text, so the SVGs need no webfont to render
correctly anywhere.

## Files

| File | Use |
|---|---|
| `app-icon.svg` | Source of the primary mark, 512 viewBox |
| `app-icon-{1024,512,256,124}.png` | Raster exports of the primary mark |
| `app-icon-light.*` | Clay ground, for a light surface |
| `app-icon-track.*` | Alternate mark: a stadium lane with an ember lead arc |
| `app-icon-track-light.*` | The track mark on clay |

Full-bleed square, no rounded corners baked in — every platform that shows the
icon applies its own corner radius.

## Re-exporting

The PNGs are screenshots of the SVGs at exact pixel sizes; any SVG rasteriser
gives the same result, e.g.

```
rsvg-convert -w 124 -h 124 app-icon.svg -o app-icon-124.png
```
