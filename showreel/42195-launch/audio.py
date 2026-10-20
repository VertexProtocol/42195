"""Synthesises soundtrack.wav for the 42195 launch film.

Everything is generated from oscillators and noise, no samples. 120 BPM,
A minor, so every hit lands on the same grid the picture is cut to:
Am | F | C | G, then F G and a resolve to C on the end card.

Instruments are written to four buses (drums, bass, music, fx) plus a reverb
send; each bus and the master are processed with Spotify's open-source
pedalboard, and the result is normalised to -14 LUFS / -1 dBTP with ffmpeg.

    pip install numpy scipy pedalboard
    python3 audio.py
"""
import json
import subprocess
import wave
import numpy as np
from scipy.signal import lfilter
from pedalboard import (Pedalboard, Chorus, Compressor, Distortion, HighpassFilter,
                        Limiter, LowpassFilter, Reverb, Gain)

SR = 48000
DUR = 15.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(42195)

BUS = {k: np.zeros((2, N)) for k in ('drums', 'bass', 'music', 'fx')}
send = np.zeros((2, N))   # reverb send
duck_src = []             # kick times for sidechain


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(sig, t, gain=1.0, pan=0.0, verb=0.0, bus='fx'):
    """Mix a mono signal onto a bus at time t with equal-power pan."""
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    a = (pan + 1) * np.pi / 4
    gl, gr = np.cos(a) * gain, np.sin(a) * gain
    tgt = BUS[bus]
    tgt[0][i:i + len(sig)] += sig * gl
    tgt[1][i:i + len(sig)] += sig * gr
    if verb:
        send[0][i:i + len(sig)] += sig * gl * verb
        send[1][i:i + len(sig)] += sig * gr * verb


def tt(d):
    return np.arange(int(d * SR)) / SR


def fft_filter(x, lo=None, hi=None):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.ones_like(f)
    if lo:
        m *= 1 / (1 + (lo / np.maximum(f, 1)) ** 4)
    if hi:
        m *= 1 / (1 + (f / hi) ** 4)
    return np.fft.irfft(X * m, len(x))


def saw(freq, t, cutoff, detune=0.0, phase=0.0):
    """Band-limited saw by additive synthesis; cutoff may be an array."""
    out = np.zeros_like(t)
    f = freq * (1 + detune)
    kmax = int(min(18000, np.max(cutoff) * 2) / f) + 1
    for k in range(1, max(2, kmax)):
        w = 1 / (1 + (k * f / cutoff) ** 4)
        out += w * np.sin(2 * np.pi * k * f * t + phase * k) / k
    return out


# ── drums ────────────────────────────────────────────────────────────────
def kick(gain=1.0, t=0.0, punch=1.0):
    d = tt(0.55)
    f = 46 + 130 * np.exp(-d * 28) * punch
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-d * 6.5)
    click = fft_filter(rng.standard_normal(len(d)), 1500, 9000) * np.exp(-d * 300) * 0.35
    sig = np.tanh((body + click) * 1.6)
    place(sig, t, 0.95 * gain, bus='drums')
    duck_src.append(t)


def clap(t, gain=1.0, verb=0.35):
    d = tt(0.4)
    n = fft_filter(rng.standard_normal(len(d)), 900, 5000)
    env = np.zeros_like(d)
    for k, o in enumerate([0, 0.011, 0.022]):
        env += (d >= o) * np.exp(-np.maximum(d - o, 0) * (180 if k < 2 else 18))
    place(n * env * 0.5, t, gain, 0.05, verb, bus='drums')


def hat(t, gain=1.0, open_=False, pan=0.3):
    d = tt(0.25 if open_ else 0.06)
    n = fft_filter(rng.standard_normal(len(d)), 7000, None)
    place(n * np.exp(-d * (14 if open_ else 70)) * 0.22, t, gain, pan, 0.05, bus='drums')


def snare(t, gain=1.0):
    d = tt(0.22)
    tone = np.sin(2 * np.pi * 190 * d) * np.exp(-d * 30)
    n = fft_filter(rng.standard_normal(len(d)), 1200, 8000) * np.exp(-d * 22)
    place((tone * 0.5 + n * 0.6) * 0.5, t, gain, -0.05, 0.25, bus='drums')


def crash(t, gain=1.0, dur=2.5):
    d = tt(dur)
    n = fft_filter(rng.standard_normal(len(d)), 3500, 14000)
    env = np.exp(-d * 2.2) * (1 - np.exp(-d * 400))
    place(n * env * 0.22, t, gain, -0.25, 0.4, bus='drums')
    n2 = fft_filter(rng.standard_normal(len(d)), 3500, 14000)
    place(n2 * env * 0.22, t, gain, 0.25, 0.4, bus='drums')


def impact(t, gain=1.0, dur=2.2):
    d = tt(dur)
    f = 30 + 70 * np.exp(-d * 6)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-d * 2.4)
    hitn = fft_filter(rng.standard_normal(len(d)), 60, 2500) * np.exp(-d * 9)
    sig = np.tanh((boom * 1.2 + hitn * 0.7) * 1.4)
    place(sig * 0.8, t, gain, 0, 0.5)


# ── fx ───────────────────────────────────────────────────────────────────
def sweep_noise(dur, f0, f1, env, block=1024):
    """Noise through a band-pass whose centre glides f0 → f1 (log)."""
    n = int(dur * SR)
    x = rng.standard_normal(n + block)
    out = np.zeros(n + block)
    win = np.hanning(block * 2)
    for s in range(0, n, block):
        p = s / n
        fc = f0 * (f1 / f0) ** p
        seg = x[s:s + block * 2]
        if len(seg) < block * 2:
            break
        X = np.fft.rfft(seg * win)
        f = np.fft.rfftfreq(block * 2, 1 / SR)
        m = np.exp(-0.5 * (np.log2(np.maximum(f, 1) / fc) / 0.6) ** 2)
        out[s:s + block * 2] += np.fft.irfft(X * m, block * 2)
    out = out[:n]
    return out / (np.max(np.abs(out)) + 1e-9) * env(np.arange(n) / n)


def whoosh(t, dur, f0=300, f1=6000, gain=1.0, pan0=0.0, pan1=0.0, verb=0.3):
    sig = sweep_noise(dur, f0, f1, lambda p: np.sin(np.pi * p) ** 1.5)
    # pan sweep: render in a few slices
    k = 8
    seg = len(sig) // k
    for j in range(k):
        place(sig[j * seg:(j + 1) * seg] * 0.5, t + j * seg / SR, gain, pan0 + (pan1 - pan0) * j / (k - 1), verb)


def riser(t, dur, gain=1.0):
    sig = sweep_noise(dur, 400, 9000, lambda p: p ** 2.2)
    d = tt(dur)
    f = 180 * 2 ** (d / dur * 2.5)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (d / dur) ** 2 * 0.25
    place(sig * 0.4 + tone, t, gain, 0, 0.35)


def reverse_cymbal(t_end, dur, gain=1.0):
    d = tt(dur)
    n = fft_filter(rng.standard_normal(len(d)), 2500, 13000)
    env = (d / dur) ** 3
    place(n * env * 0.35, t_end - dur, gain, 0, 0.3)


def bell(t, m, gain=1.0, pan=0.0, dur=1.2, verb=0.45):
    d = tt(dur)
    f = hz(m)
    idx = 3.0 * np.exp(-d * 6)
    mod = np.sin(2 * np.pi * f * 3.5 * d) * idx
    sig = np.sin(2 * np.pi * f * d + mod) * np.exp(-d * 4) * (1 - np.exp(-d * 2000))
    sig += 0.35 * np.sin(2 * np.pi * f * 2 * d) * np.exp(-d * 9)
    place(sig * 0.32, t, gain, pan, verb, bus='music')


def tick(t, gain=1.0, pan=0.0, hi=True):
    d = tt(0.012)
    n = fft_filter(rng.standard_normal(len(d)), 3000 if hi else 1200, 12000)
    place(n * np.exp(-d * 600) * 0.35, t, gain, pan, 0.02)


def blip(t, f0, f1, dur=0.12, gain=1.0, pan=0.0):
    d = tt(dur)
    f = f0 * (f1 / f0) ** (d / dur)
    sig = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-d * 18) * (1 - np.exp(-d * 3000))
    place(sig * 0.3, t, gain, pan, 0.2)


def glide(t, dur, f0, f1, gain=1.0, pan=0.0):
    d = tt(dur)
    f = f0 * (f1 / f0) ** (d / dur)
    env = np.sin(np.pi * d / dur) ** 0.6
    sig = (np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.3 * np.sin(4 * np.pi * np.cumsum(f) / SR)) * env
    place(sig * 0.12, t, gain, pan, 0.3)


# ── tonal ────────────────────────────────────────────────────────────────
def bass_note(t, m, dur, gain=1.0, cutoff=900):
    d = tt(dur)
    env = (1 - np.exp(-d * 400)) * np.exp(-d * 3) * (1 - np.clip((d - dur + 0.02) / 0.02, 0, 1))
    cut = cutoff * (0.35 + 0.65 * np.exp(-d * 10))
    sig = saw(hz(m), d, cut) * 0.6 + np.sin(2 * np.pi * hz(m) * d) * 0.7
    place(np.tanh(sig * env * 1.3) * 0.45, t, gain, 0, 0, bus='bass')


def stab(t, notes, dur=0.32, gain=1.0, cutoff=3500, verb=0.35):
    d = tt(dur + 0.3)
    env = (1 - np.exp(-d * 600)) * np.exp(-d * 7)
    cut = cutoff * (0.3 + 0.7 * np.exp(-d * 9))
    for j, m in enumerate(notes):
        for v, det in enumerate([-0.011, -0.004, 0.0, 0.005, 0.012]):
            sig = saw(hz(m), d, cut, det, phase=rng.random() * 6.28)
            place(sig * env * 0.06, t, gain, (v - 2) * 0.35, verb, bus='music')


def pad(t, notes, dur, gain=1.0, attack=0.6, cutoff=2200):
    d = tt(dur)
    env = (1 - np.exp(-d / attack * 3)) * np.clip((dur - d) / 0.8, 0, 1)
    for j, m in enumerate(notes):
        for v, det in enumerate([-0.006, 0.0, 0.007]):
            sig = saw(hz(m), d, cutoff, det, phase=rng.random() * 6.28)
            place(sig * env * 0.035, t, gain, (v - 1) * 0.6, 0.6, bus='music')


def pluck(t, m, gain=1.0, pan=0.0, dur=0.9, bright=0.6, verb=0.3):
    """Karplus-Strong string: a noise burst through a damped comb."""
    n = int(dur * SR)
    period = SR / hz(m)
    p = int(period)
    frac = period - p
    exc = np.zeros(n)
    burst = rng.standard_normal(p) * np.hanning(p)
    burst = lfilter([bright, 1 - bright], [1], burst)
    exc[:p] = burst
    g = 0.996
    a = np.zeros(p + 2)
    a[0] = 1
    a[p] = -g * (1 - frac) * 0.5
    a[p + 1] = -g * 0.5
    y = lfilter([1], a, exc)
    y *= np.exp(-np.arange(n) / SR * 3.2)
    y /= np.max(np.abs(y)) + 1e-9
    place(y * 0.22, t, gain, pan, verb, bus='music')


# A minor world: Am F C G
CH = {
    'Am': [57, 60, 64, 69], 'F': [53, 57, 60, 65], 'C': [55, 60, 64, 67], 'G': [55, 59, 62, 67],
    'Cmaj9': [48, 55, 59, 62, 64, 67],
}
ROOT = {'Am': 33, 'F': 29, 'C': 36, 'G': 31}

# ═════════════════════════════════════════════════════════════════════════
# 0 – 2  hook: tension, roller ticks, the slash, the badge, the wipe
for i in range(30):
    tick(0.0 + i * 0.016, 0.5 + 0.5 * (i % 3 == 0), 0.2 * np.sin(i))
whoosh(0.38, 0.16, 800, 9000, 0.7, -0.6, 0.6, 0.2)          # strike slash
impact(0.5, 0.55, 1.4)
clap(0.5, 0.8, 0.5)
for i in range(40):
    tick(0.86 + i * 0.014 * (1 + i / 30), 0.45, -0.2 + 0.4 * (i % 2))
blip(1.3, 500, 1500, 0.14, 1.0)
bell(1.32, 81, 0.6, 0.3, 0.8)
pad(0.0, [45, 52], 2.0, 0.8, attack=1.5, cutoff=500)
whoosh(1.6, 0.42, 200, 7000, 1.0, 0.4, -0.2, 0.25)

# 2 – 4  build: word slams on the beat, riser, snare roll, slats
for b in [2.0, 2.5, 3.0, 3.5]:
    kick(0.5, b, 0.6)
for w in [2.0, 2.25, 2.5, 3.0, 3.25]:
    clap(w, 0.4, 0.3)
    blip(w, 180, 90, 0.18, 0.9)
for k in range(8):
    bass_note(2.0 + k * 0.25, ROOT['Am'] + (12 if k % 2 else 0), 0.22, 0.55, 400 + k * 90)
riser(2.9, 1.1, 1.0)
for k in range(16):
    tt_ = 3.5 + 0.5 * (1 - (1 - k / 16) ** 1.4)
    snare(tt_, 0.25 + 0.6 * k / 16)
whoosh(3.68, 0.3, 300, 5000, 0.7, -0.8, 0.8, 0.15)
reverse_cymbal(4.0, 0.9, 0.9)

# 4 – 6  drop: logo
impact(4.0, 1.0, 2.0)
crash(4.0, 1.0, 2.5)
stab(4.0, CH['Am'], 0.5, 1.1, 4200)
for b in np.arange(4.0, 5.5, BEAT):
    kick(1.0, b)
for b in [4.5, 5.5]:
    clap(b, 0.7)
for b in np.arange(4.0, 5.5, 0.25):
    hat(b + 0.125, 0.8)
for k in range(12):
    bass_note(4.0 + k * 0.125 + 0.0625 * 0, ROOT['Am'] + (12 if k % 4 == 2 else 0), 0.11, 1.0, 1100)
pad(4.0, CH['Am'], 2.0, 1.0)
bell(4.95, 76, 0.55, -0.3)                                     # the lead settles after its lap
for i in range(5):
    tick(4.62 + 0.5 + i * 0.07, 0.6, -0.4 + 0.2 * i)            # wordmark digits land
for i in range(38):
    tick(5.15 + i * 0.0118, 0.35, 0.1, hi=False)               # tagline types
reverse_cymbal(6.0, 0.5, 1.0)
whoosh(5.6, 0.42, 120, 3000, 1.2, 0, 0, 0.4)                    # into the infield

# 6 – 10.5  product: F then C then G
whoosh(6.0, 0.6, 2000, 200, 0.9, 0.6, -0.1, 0.3)                # phone flies in
impact(6.0, 0.5, 1.2)
for bar, ch, t0 in [(0, 'F', 6.0), (1, 'C', 8.0), (2, 'G', 10.0)]:
    pad(t0, CH[ch], 2.0 if ch != 'G' else 0.5, 1.0)
    end = t0 + (2.0 if ch != 'G' else 0.5)
    for b in np.arange(t0, end - 1e-6, BEAT):
        kick(1.0, b)
        hat(b + 0.25, 0.9, open_=True, pan=0.25)
        hat(b + 0.125, 0.4, pan=-0.3)
        hat(b + 0.375, 0.4, pan=-0.3)
        bass_note(b + 0.25, ROOT[ch], 0.2, 1.0, 1300)
        bass_note(b + 0.375, ROOT[ch] + 12, 0.1, 0.7, 1500)
    for b in np.arange(t0 + 0.5, end - 1e-6, 1.0):
        clap(b, 0.7)
    for b in np.arange(t0, end - 1e-6, 1.0):
        stab(b + 0.75, CH[ch], 0.18, 0.55, 3000)
for c, tc in [(-0.5, 6.6), (0.5, 7.45), (0.5, 8.75)]:
    blip(tc, 700, 1400, 0.09, 0.7, c)                          # callouts
    tick(tc + 0.2, 0.5, c)
glide(6.45, 0.9, 300, 620, 0.8, -0.2)                           # the race lap draws
glide(7.45, 0.6, 420, 840, 0.9, 0.2)                            # weekly targets fill
for i in range(6):
    tick(8.0 + i * 0.06, 0.4, 0.3)                              # sync
glide(8.25, 0.4, 520, 1500, 1.2, 0.0)                           # the run lands, the week is won
impact(8.6, 0.7, 1.4)
bell(8.6, 88, 1.1, 0.15)                                        # Uka er i boks!
bell(8.72, 95, 0.9, -0.15)
crash(8.6, 0.5, 1.6)
for i in range(18):
    tick(8.6 + i * 0.022 * (1 + i / 12), 0.4, 0.3)
snare(9.75, 0.5); snare(9.875, 0.6)
whoosh(9.9, 0.7, 250, 9000, 1.4, 0.8, -0.8, 0.2)                # whip pan

# 10.5 – 12  montage: G, dings climbing the chord as the feed stacks
kick(1.0, 10.5); crash(10.5, 0.6, 1.5)
for b in np.arange(10.5, 12.0, BEAT):
    if b > 10.5:
        kick(1.0, b)
    hat(b + 0.25, 0.8, True)
    bass_note(b + 0.25, ROOT['G'], 0.2, 1.0, 1300)
    bass_note(b + 0.375, ROOT['G'] + 12, 0.1, 0.7, 1500)
for b in [11.0, 11.5]:
    clap(b, 0.7)
pad(10.5, CH['G'], 1.5, 1.0)
arp = [67, 71, 74, 79, 83, 86, 91, 86, 83, 79, 83, 86]
for i, m in enumerate(arp):
    bell(10.62 + i * 0.115, m, 0.55, -0.6 + 1.2 * (i % 2), 0.6, 0.35)
vel_t = 10.62
while vel_t < 11.85:                                            # odometer ticks slowing down
    p = (vel_t - 10.62) / 1.23
    tick(vel_t, 0.35, -0.4)
    vel_t += 0.012 + 0.11 * p ** 2

# 12 – 13  slams: F, G
for t0, ch in [(12.0, 'F'), (12.5, 'G')]:
    kick(1.1, t0, 1.3)
    clap(t0, 0.9, 0.5)
    stab(t0, CH[ch], 0.4, 1.2, 5000)
    bass_note(t0, ROOT[ch], 0.45, 1.1, 1500)
    impact(t0, 0.55, 0.9)
kick(0.8, 12.25); kick(0.8, 12.75)
for k in range(8):
    snare(12.75 + k * 0.03, 0.2 + 0.08 * k)
reverse_cymbal(13.0, 0.4, 1.0)

# ── melody: a plucked arpeggio through the groove, and the motif ──────────
ARP = [0, 2, 1, 3, 2, 1, 3, 2]
for t0, t1, ch in [(4.0, 5.5, 'Am'), (6.0, 8.0, 'F'), (8.0, 9.9, 'C'), (10.5, 12.0, 'G')]:
    tones = CH[ch]
    for k, b in enumerate(np.arange(t0, t1 - 1e-6, 0.125)):
        m = tones[ARP[k % 8]] + 12
        pluck(b, m, 0.45 + 0.25 * (k % 4 == 0), -0.45 + 0.9 * ((k // 2) % 2), 0.5, 0.5, 0.25)
for i, m in enumerate([76, 74, 72, 69]):                        # the drop: down and round
    pluck(4.0 + i * 0.25, m, 1.0, 0.0, 1.2, 0.75, 0.4)
    pluck(4.0 + i * 0.25, m - 12, 0.6, 0.0, 1.2, 0.5, 0.4)
for i, m in enumerate([72, 76, 79, 84]):                        # the launch: up and home
    pluck(13.0 + i * 0.25, m, 1.0, -0.2 + 0.13 * i, 1.6, 0.75, 0.5)
    pluck(13.0 + i * 0.25, m - 12, 0.55, 0.0, 1.6, 0.5, 0.5)

# 13 – 15  launch: resolve to C, let it ring
impact(13.0, 1.1, 2.0)
crash(13.0, 1.1, 2.0)
stab(13.0, CH['Cmaj9'], 0.8, 1.0, 5200, 0.6)
pad(13.0, CH['Cmaj9'], 2.0, 1.4, attack=0.15, cutoff=3200)
bass_note(13.0, ROOT['C'], 1.4, 1.0, 900)
for b in [13.5, 14.0]:
    kick(0.7, b)
    hat(b + 0.25, 0.6, True)
clap(13.5, 0.5)
bell(13.4, 84, 0.6, -0.3)                                       # Nå tilgjengelig
for i, m in enumerate([72, 76, 79, 84]):
    bell(14.05 + i * 0.06, m, 0.35, -0.4 + 0.27 * i, 1.0)      # a last lap
bell(14.62, 91, 0.5, 0.0, 0.4)

# ── mix ──────────────────────────────────────────────────────────────────
t_axis = np.arange(N) / SR
duck = np.ones(N)
for k in duck_src:
    d = t_axis - k
    m = d >= 0
    duck[m] = np.minimum(duck[m], 1 - 0.65 * np.exp(-d[m] / 0.12))


# arrangement: hold the build back so the drop at 4.0 lands
arr = np.interp(t_axis, [0, 1.95, 2.0, 3.6, 3.98, 4.0, 15], [0.75, 0.75, 0.5, 0.62, 0.8, 1.0, 1.0])
for k in BUS:
    BUS[k] *= arr
send *= arr


def fx(board, x):
    return board(x.astype(np.float32), SR)


drums = fx(Pedalboard([Compressor(threshold_db=-14, ratio=4, attack_ms=4, release_ms=90),
                       Distortion(drive_db=2.5), Gain(gain_db=1.5)]), BUS['drums'])
bass = fx(Pedalboard([Distortion(drive_db=7), LowpassFilter(cutoff_frequency_hz=1900),
                      Compressor(threshold_db=-16, ratio=3, attack_ms=10, release_ms=120)]), BUS['bass']) * duck
music = fx(Pedalboard([HighpassFilter(cutoff_frequency_hz=140), Chorus(rate_hz=0.5, depth=0.18, mix=0.35),
                       Compressor(threshold_db=-18, ratio=2.5, attack_ms=15, release_ms=150)]), BUS['music']) * duck
sfx = fx(Pedalboard([HighpassFilter(cutoff_frequency_hz=40)]), BUS['fx'])
verb = fx(Pedalboard([HighpassFilter(cutoff_frequency_hz=250), Reverb(room_size=0.82, damping=0.45, wet_level=1.0,
                      dry_level=0.0, width=1.0), LowpassFilter(cutoff_frequency_hz=8500)]), send) * (0.6 + 0.4 * duck)

mix = drums * 1.0 + bass * 0.9 + music * 1.1 + sfx * 0.9 + verb * 0.5
mix = fx(Pedalboard([HighpassFilter(cutoff_frequency_hz=28),
                     Compressor(threshold_db=-12, ratio=2, attack_ms=12, release_ms=140),
                     Limiter(threshold_db=-3.0, release_ms=120)]), mix / (np.max(np.abs(mix)) + 1e-9))
mix *= np.clip((DUR - t_axis) / 0.35, 0, 1)


def write(path, x):
    pcm = (np.clip(x, -1, 1).T * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# loudness: two-pass ffmpeg loudnorm to -14 LUFS integrated, -1 dBTP
write('.premaster.wav', mix)
target = 'I=-14:TP=-1.0:LRA=11'
probe = subprocess.run(['ffmpeg', '-hide_banner', '-i', '.premaster.wav', '-af', f'loudnorm={target}:print_format=json',
                        '-f', 'null', '-'], capture_output=True, text=True).stderr
m = json.loads(probe[probe.rindex('{'):probe.rindex('}') + 1])
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', '.premaster.wav', '-af',
                f"loudnorm={target}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
                f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true",
                '-ar', str(SR), '-c:a', 'pcm_s16le', 'soundtrack.wav'], check=True)
subprocess.run(['rm', '-f', '.premaster.wav'])
print('wrote soundtrack.wav; pre-master loudness', m['input_i'], 'LUFS')
