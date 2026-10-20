# 42195 — launch film

A 15-second launch spot for 42195, built in the app's own visual world
("Tartan", see `DESIGN.md`): espresso ground, chalk surfaces, clay for the
track itself, one ember accent that only marks action or position, Figtree for
words and JetBrains Mono for every measurement. The lane runs anticlockwise
everywhere, as `TrackMark`, `TrackLoader` and `ProgressLap` do in the app.

`42195-launch.mp4` — 1920×1080, 60 fps, H.264 + AAC, with its own soundtrack.

## The cut

120 BPM, one beat = 0.5 s. Every cut and hit lands on the grid.

| Time | Scene | What happens |
|---|---|---|
| 0.0–2.0 | The name | "42 195 m" spins in on rollers, "Et maraton, i meter.", the ember lane rule from the 42 mark draws under it and opens into the clay ground |
| 2.0–4.0 | The straight | "Ett tall. Én beslutning. Hver dag." word by word on the beat over running-track lanes, the weight easing from 300 to 800; "dag." takes the ember pill; slats shut |
| 4.0–6.0 | The mark | Lanes spread out from the track mark, the lead arc runs one lap anticlockwise and settles where the icon draws it, the wordmark rolls in, the tagline types on, the camera flies into the infield |
| 6.0–10.5 | Today | The phone, dark theme: the race lap fills from the start line, the days roll in, the weekly targets fill, a run syncs, the week is won and "Uka er i boks!" breaks out of the frame; three callouts; whip-pan out |
| 10.5–12.0 | The year | "Løpt i år" counts up to 1 248 km while a feed of runs, badges and coach notes stacks in, each one a note in a rising arpeggio |
| 12.0–13.0 | Slams | "Sett et mål." on clay, "Hver meter teller." on espresso |
| 13.0–15.0 | Launch | The lockup over eight lanes, runners as lane markers going round anticlockwise, "Nå tilgjengelig" |

Things the film keeps from `DESIGN.md`: no glows, halos or gradient text; the
ember never decorates; state tints a card's border; motion is the app's
`cubic-bezier(0.16, 1, 0.3, 1)` ease-out, with no bounce.

## How it is made

- `index.html` is the whole film. `draw(t)` sets every element from time alone,
  so the same page plays in a browser and renders frame-exact.
  Open it through any static server to watch it in real time with sound
  (`npx http-server .`, then click to replay); `?t=8.8` freezes a single moment.
- `audio.py` synthesises `soundtrack.wav` from oscillators and noise: kick, clap,
  hats, side-chained bass and supersaw stabs on Am–F–C–G, risers, whooshes,
  FM bells, convolution reverb. `python3 audio.py` (needs numpy).
- `render.mjs` drives headless Chromium with Playwright and pipes frames to
  ffmpeg. Each frame averages four sub-frames across a 180° shutter, so the
  motion blur is real. `node render.mjs`, or `node render.mjs --stills 4.6,8.8`
  for checking frames.

Fonts are bundled from Fontsource under the SIL Open Font License: Figtree and
JetBrains Mono, the app's two families.

The race, runs, distances and coach notes on screen are illustrative.
