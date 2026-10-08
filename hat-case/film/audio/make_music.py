"""Background music for the film: a soft, slow piano-and-pad bed in D major.

Usage: python3 film/audio/make_music.py <seconds> <out.wav>
Synthesized here (additive synthesis + convolution reverb) so the film
carries no third-party music licence.
"""
import sys
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(3)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def tone(freq, dur, partials, detune_cents=0.0):
    t = np.arange(int(dur * SR)) / SR
    out = np.zeros_like(t)
    f = freq * 2 ** (detune_cents / 1200)
    for k, a in partials:
        out += a * np.sin(2 * np.pi * f * k * t + rng.uniform(0, 2 * np.pi))
    return out


def pad_chord(notes, dur):
    """Warm pad: three slightly detuned voices per note, slow swell."""
    n = int(dur * SR)
    out = np.zeros((n, 2))
    t = np.arange(n) / SR
    env = np.minimum(t / 2.2, 1.0) * np.minimum((dur - t) / 2.2, 1.0)
    env = np.clip(env, 0, 1) ** 1.5
    for i, m in enumerate(notes):
        for d, pan in ((-5, 0.3), (0, 0.5), (5, 0.7)):
            v = tone(midi(m), dur, [(1, 1.0), (2, 0.18), (3, 0.05)], d) * env
            out[:, 0] += v * (1 - pan) * 0.06
            out[:, 1] += v * pan * 0.06
    # slow movement
    lfo = 0.85 + 0.15 * np.sin(2 * np.pi * 0.07 * t)
    return out * lfo[:, None]


def piano(freq, dur=3.2, vel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k, a in ((1, 1.0), (2, 0.42), (3, 0.16), (4, 0.08), (5, 0.03)):
        fk = freq * k * (1 + 0.0004 * k * k)
        out += a * np.exp(-t * (1.1 + 0.9 * k)) * np.sin(2 * np.pi * fk * t)
    attack = np.minimum(t / 0.006, 1.0)
    return out * attack * vel * 0.16


def reverb(x, seconds=3.2):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.stack([rng.standard_normal(n), rng.standard_normal(n)], 1) * np.exp(-t * 2.4)[:, None]
    ir[: int(0.012 * SR)] = 0
    L = len(x) + n
    size = 1 << int(np.ceil(np.log2(L)))
    out = np.zeros((L, 2))
    for c in range(2):
        out[:, c] = np.fft.irfft(np.fft.rfft(x[:, c], size) * np.fft.rfft(ir[:, c], size), size)[:L]
    return out[: len(x)] / np.abs(ir).sum(0).max() * 6.0


def main():
    total = float(sys.argv[1])
    dst = sys.argv[2]
    n = int(total * SR)
    mix = np.zeros((n, 2))
    beat = 60 / 66  # 66 bpm
    bar = beat * 4
    chords = [  # Dmaj9, Bm11, Gmaj7, A6sus4
        [50, 57, 61, 64, 66],
        [47, 54, 57, 62, 64],
        [43, 50, 54, 59, 62],
        [45, 52, 57, 59, 62],
    ]
    span = bar * 2
    t0 = 0.0
    i = 0
    while t0 < total:
        notes = chords[i % 4]
        dur = min(span + 2.2, total - t0 + 0.5)
        seg = pad_chord(notes, dur)
        s = int(t0 * SR)
        e = min(n, s + len(seg))
        mix[s:e] += seg[: e - s]
        # bass
        bass = tone(midi(notes[0] - 12), dur, [(1, 1.0), (2, 0.25)]) * 0.05
        benv = np.clip(np.minimum(np.arange(len(bass)) / SR / 1.5, 1) * np.minimum((dur - np.arange(len(bass)) / SR) / 1.5, 1), 0, 1)
        mix[s:e, 0] += (bass * benv)[: e - s]
        mix[s:e, 1] += (bass * benv)[: e - s]
        # sparse felt-piano figure, gentler while the voice talks (kept simple: every beat)
        top = [notes[2] + 12, notes[3] + 12, notes[4] + 12, notes[3] + 12, notes[1] + 12, notes[4] + 12, notes[2] + 12, notes[3] + 12]
        for k in range(8):
            if rng.random() < 0.28:
                continue
            tt = t0 + k * beat + rng.normal(0, 0.012)
            if tt >= total - 1:
                continue
            p = piano(midi(top[k]), vel=0.75 + 0.25 * rng.random())
            ps = int(tt * SR)
            pe = min(n, ps + len(p))
            pan = 0.35 + 0.3 * rng.random()
            mix[ps:pe, 0] += p[: pe - ps] * (1 - pan)
            mix[ps:pe, 1] += p[: pe - ps] * pan
        t0 += span
        i += 1
    wet = reverb(mix)
    out = mix * 0.75 + wet * 0.5
    t = np.arange(n) / SR
    fade = np.minimum(t / 2.5, 1.0) * np.minimum((total - t) / 3.5, 1.0)
    out *= np.clip(fade, 0, 1)[:, None]
    out *= 0.5 / np.abs(out).max()  # peak -6 dBFS; the mix sets the final level
    data = (np.clip(out, -1, 1) * 32767).astype(np.int16)
    with wave.open(dst, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(f"saved {dst} ({total:.1f} s)")


if __name__ == "__main__":
    main()
