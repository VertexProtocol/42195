# Prisvakt — launch film

A 15-second launch spot for **Prisvakt**, a price-watch app: follow a product,
set a target price, get told the second it drops.

`prisvakt-launch.mp4` — 1920×1080, 60 fps, H.264 + AAC, with its own soundtrack.

## The cut

120 BPM, one beat = 0.5 s. Every cut and hit lands on the grid.

| Time | Scene | What happens |
|---|---|---|
| 0.0–2.0 | Hook | "Du betalte 2 499,-" spins in on slot-machine rollers, gets slashed, steps back; "1 699,-" spins in under it; the −32 % badge pops and grows into a circle wipe |
| 2.0–4.0 | Build | Kinetic type on volt, word by word on the beat, the variable width axis easing from 125 to 96; tickers of prices race behind; "tiden." flips to ink; slats shut |
| 4.0–6.0 | Drop | Logo hit: shockwave, particle burst, the tag's eye opens and looks around, the wordmark lands letter by letter, the dot drops onto the ı, tagline types on, then the camera flies into the pupil |
| 6.0–10.5 | Product | A 3D phone flies in on a spring; price history draws, a finger drags the target price, the price falls through it, the notification breaks out of the frame; three callouts with leader lines; whip-pan out |
| 10.5–12.0 | Scale | Savings odometer counts to 14 870 kr while a tilted feed of alerts stacks in, each one a note in a rising arpeggio |
| 12.0–13.0 | Slams | "Sett målpris." / "Vi holder vakt." on consecutive beats, inverted |
| 13.0–15.0 | Launch | Lockup on a turning sunburst, tags orbiting in depth, "Lanseres i dag", glint, a last blink |

## How it is made

- `index.html` is the whole film. `draw(t)` sets every element from time alone,
  so the same page plays in a browser and renders frame-exact.
  Open it through any static server to watch it in real time with sound
  (`npx http-server .`, then click to replay); `?t=4.6` freezes a single moment.
- `audio.py` synthesises `soundtrack.wav` from oscillators and noise: kick, clap,
  hats, side-chained bass and supersaw stabs on Am–F–C–G, risers, whooshes,
  FM bells for the alerts, convolution reverb. `python3 audio.py` (needs numpy).
- `render.mjs` drives headless Chromium with Playwright and pipes frames to
  ffmpeg. Each frame averages four sub-frames across a 180° shutter, so the
  motion blur is real, not faked. `node render.mjs`, or
  `node render.mjs --stills 4.6,8.7` for checking frames.

Fonts are bundled from Fontsource under the SIL Open Font License: Archivo
(variable, width and weight axes), Inter Tight, JetBrains Mono.

The products, prices and savings on screen are illustrative.
