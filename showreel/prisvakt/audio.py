"""Synthesises soundtrack.wav for the Prisvakt launch film.

Everything is generated from oscillators and noise, no samples. 120 BPM,
A minor, so every hit lands on the same grid the picture is cut to:
Am | F | C | G, then F G and a resolve to C on the end card.

    python3 audio.py
"""
import wave
import numpy as np

SR = 48000
DUR = 15.0
N = int(SR * DUR)
BEAT = 0.5
rng = np.random.default_rng(42195)

L = np.zeros(N)
R = np.zeros(N)
send = np.zeros((2, N))   # reverb send
duck_src = []             # kick times for sidechain


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(sig, t, gain=1.0, pan=0.0, verb=0.0, duck=False, buses=None):
    """Mix a mono signal in at time t with equal-power pan."""
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    a = (pan + 1) * np.pi / 4
    gl, gr = np.cos(a) * gain, np.sin(a) * gain
    tgt = buses if buses is not None else (DUCKED if duck else DRY)
    tgt[0][i:i + len(sig)] += sig * gl
    tgt[1][i:i + len(sig)] += sig * gr
    if verb:
        send[0][i:i + len(sig)] += sig * gl * verb
        send[1][i:i + len(sig)] += sig * gr * verb


DRY = (L, R)
DUCKED = (np.zeros(N), np.zeros(N))


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
    place(sig, t, 0.95 * gain)
    duck_src.append(t)


def clap(t, gain=1.0, verb=0.35):
    d = tt(0.4)
    n = fft_filter(rng.standard_normal(len(d)), 900, 5000)
    env = np.zeros_like(d)
    for k, o in enumerate([0, 0.011, 0.022]):
        env += (d >= o) * np.exp(-np.maximum(d - o, 0) * (180 if k < 2 else 18))
    place(n * env * 0.5, t, gain, 0.05, verb)


def hat(t, gain=1.0, open_=False, pan=0.3):
    d = tt(0.25 if open_ else 0.06)
    n = fft_filter(rng.standard_normal(len(d)), 7000, None)
    place(n * np.exp(-d * (14 if open_ else 70)) * 0.22, t, gain, pan, 0.05)


def snare(t, gain=1.0):
    d = tt(0.22)
    tone = np.sin(2 * np.pi * 190 * d) * np.exp(-d * 30)
    n = fft_filter(rng.standard_normal(len(d)), 1200, 8000) * np.exp(-d * 22)
    place((tone * 0.5 + n * 0.6) * 0.5, t, gain, -0.05, 0.25)


def crash(t, gain=1.0, dur=2.5):
    d = tt(dur)
    n = fft_filter(rng.standard_normal(len(d)), 3500, 14000)
    env = np.exp(-d * 2.2) * (1 - np.exp(-d * 400))
    place(n * env * 0.22, t, gain, -0.25, 0.4)
    n2 = fft_filter(rng.standard_normal(len(d)), 3500, 14000)
    place(n2 * env * 0.22, t, gain, 0.25, 0.4)


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
    place(sig * 0.32, t, gain, pan, verb)


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
    place(np.tanh(sig * env * 1.3) * 0.45, t, gain, 0, 0, duck=True)


def stab(t, notes, dur=0.32, gain=1.0, cutoff=3500, verb=0.35):
    d = tt(dur + 0.3)
    env = (1 - np.exp(-d * 600)) * np.exp(-d * 7)
    cut = cutoff * (0.3 + 0.7 * np.exp(-d * 9))
    for j, m in enumerate(notes):
        for v, det in enumerate([-0.011, -0.004, 0.0, 0.005, 0.012]):
            sig = saw(hz(m), d, cut, det, phase=rng.random() * 6.28)
            place(sig * env * 0.06, t, gain, (v - 2) * 0.35, verb, duck=True,
                  buses=DUCKED)


def pad(t, notes, dur, gain=1.0, attack=0.6, cutoff=2200):
    d = tt(dur)
    env = (1 - np.exp(-d / attack * 3)) * np.clip((dur - d) / 0.8, 0, 1)
    for j, m in enumerate(notes):
        for v, det in enumerate([-0.006, 0.0, 0.007]):
            sig = saw(hz(m), d, cutoff, det, phase=rng.random() * 6.28)
            place(sig * env * 0.035, t, gain, (v - 1) * 0.6, 0.6, duck=True, buses=DUCKED)


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
bell(4.2, 76, 0.5, -0.3)                                       # eye opens
for lk, pan in [(4.62, -0.5), (4.95, 0.5), (5.3, 0.0)]:
    blip(lk, 1200, 1700, 0.05, 0.5, pan)
for i in range(38):
    tick(5.15 + i * 0.0118, 0.35, 0.1, hi=False)               # tagline types
blip(5.42, 900, 400, 0.08, 0.5)                                # blink
reverse_cymbal(6.0, 0.5, 1.0)
whoosh(5.6, 0.42, 120, 3000, 1.2, 0, 0, 0.4)                    # into the pupil

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
glide(7.6, 0.5, 900, 520, 1.0, 0.2)                             # dragging the target
glide(8.2, 0.42, 1400, 260, 1.4, 0.0)                           # the price falls
impact(8.6, 0.7, 1.4)
bell(8.6, 88, 1.1, 0.15)                                        # notification
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
bell(13.4, 84, 0.6, -0.3)                                       # LANSERES I DAG
for i, m in enumerate([72, 76, 79, 84]):
    bell(14.0 + i * 0.06, m, 0.35, -0.4 + 0.27 * i, 1.0)       # glint
blip(14.55, 900, 400, 0.08, 0.5)                               # final blink
bell(14.62, 91, 0.5, 0.0, 0.4)

# ── mix ──────────────────────────────────────────────────────────────────
t_axis = np.arange(N) / SR
duck = np.ones(N)
for k in duck_src:
    d = t_axis - k
    m = d >= 0
    duck[m] = np.minimum(duck[m], 1 - 0.7 * np.exp(-d[m] / 0.11))
L += DUCKED[0] * duck
R += DUCKED[1] * duck

# convolution reverb from a synthetic stereo tail
ir_len = int(2.2 * SR)
d = np.arange(ir_len) / SR
for ch, out in ((0, L), (1, R)):
    ir = rng.standard_normal(ir_len) * np.exp(-d * 3.2)
    ir = fft_filter(ir, 200, 7000)
    ir[: int(0.012 * SR)] = 0
    ir /= np.sqrt(np.sum(ir ** 2))
    n = 1 << int(np.ceil(np.log2(N + ir_len)))
    wet = np.fft.irfft(np.fft.rfft(send[ch], n) * np.fft.rfft(ir, n), n)[:N]
    out += wet * 0.55

mix = np.stack([L, R])
mix = fft_filter(mix[0], 25, None), fft_filter(mix[1], 25, None)
mix = np.stack(mix)
mix = np.tanh(mix / (np.max(np.abs(mix)) * 0.55)) * 0.89          # glue + ceiling
fade = np.clip((DUR - t_axis) / 0.35, 0, 1)
mix *= fade
pcm = (mix.T * 32767).astype('<i2')
with wave.open('soundtrack.wav', 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('wrote soundtrack.wav', pcm.shape, 'peak', np.max(np.abs(mix)))
