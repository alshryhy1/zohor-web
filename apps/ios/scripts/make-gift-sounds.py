#!/usr/bin/env python3
"""Write short WAV gifts from acoustic models of the real sources."""

from __future__ import annotations

import math
import os
import struct
import wave

RATE = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "Zohor", "Sounds")


def clamp(x: float) -> float:
    return max(-0.98, min(0.98, x))


def env(t: float, attack: float, hold: float, release: float) -> float:
    if t < 0:
        return 0.0
    if t < attack:
        return t / max(1e-4, attack)
    if t < attack + hold:
        return 1.0
    u = t - attack - hold
    if u >= release:
        return 0.0
    return max(0.0, 1.0 - u / max(1e-4, release))


def write_wav(name: str, samples: list[float]) -> None:
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.wav")
    with wave.open(path, "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        frames = b"".join(struct.pack("<h", int(clamp(s) * 32767)) for s in samples)
        wav.writeframes(frames)
    print(path, len(samples) / RATE)


def noise(i: int) -> float:
    x = (i * 1103515245 + 12345) & 0x7FFFFFFF
    return (x / 0x7FFFFFFF) * 2 - 1


def falcon() -> list[float]:
    # Red-tailed hawk "kee-eee-arr": falling whistle, ~1.8s, weak harmonics.
    n = int(RATE * 2.05)
    out = [0.0] * n
    phase = 0.0
    for i in range(n):
        t = i / RATE
        k1 = env(t, 0.02, 0.55, 0.35)
        k2 = env(t - 0.72, 0.018, 0.42, 0.38)
        f1 = 2800 * math.pow(0.38, min(1.0, t / 0.95))
        f2 = 2400 * math.pow(0.34, min(1.0, max(0.0, t - 0.72) / 0.85))
        phase += 2 * math.pi * (f1 * k1 + f2 * k2 * 0.15) / RATE
        rasp = 1 + 0.08 * math.sin(2 * math.pi * 18 * t)
        s = math.sin(phase) * rasp * (0.72 * k1 + 0.58 * k2)
        s += 0.12 * math.sin(phase * 2.01) * (k1 + k2)
        out[i] = s
    return out


def horse() -> list[float]:
    # Arabian horse neigh: trumpet-like, rises then falls, slow vibrato — not a bleat.
    n = int(RATE * 2.35)
    out = [0.0] * n
    phase = 0.0
    for i in range(n):
        t = i / RATE
        if t < 0.22:
            f = 520 + t / 0.22 * 680
        elif t < 0.95:
            f = 1200 - (t - 0.22) / 0.73 * 640
        else:
            f = 560 - (t - 0.95) * 90
        f += 18 * math.sin(2 * math.pi * 5.2 * t)
        phase += 2 * math.pi * f / RATE
        voice = env(t, 0.05, 1.15, 0.95)
        formant = math.sin(phase) + 0.35 * math.sin(phase * 2) + 0.12 * math.sin(phase * 3)
        breath = noise(i) * 0.06 * voice
        hoof = math.sin(2 * math.pi * 78 * t) * env(t, 0.004, 0.02, 0.08) * 0.18
        out[i] = (formant * 0.55 + breath) * voice + hoof
    return out


def yacht() -> list[float]:
    n = int(RATE * 3.4)
    out = [0.0] * n
    p = 0.0
    for i in range(n):
        t = i / RATE
        diesel = math.sin(2 * math.pi * 28 * t) * 0.16 + math.sin(2 * math.pi * 56 * t) * 0.07
        water = noise(i) * (0.4 + 0.6 * math.sin(2 * math.pi * 0.45 * t)) * 0.05
        p += 2 * math.pi * 87 / RATE
        horn = env(t - 0.18, 0.28, 1.6, 1.1)
        tone = math.sin(p) + 0.45 * math.sin(p * 2) + 0.16 * math.sin(p * 3)
        swell = env(t, 0.2, 2.4, 0.8)
        out[i] = (diesel + water) * swell + tone * horn * 0.48
    return out


def car() -> list[float]:
    n = int(RATE * 2.8)
    out = [0.0] * n
    p = 0.0
    for i in range(n):
        t = i / RATE
        rpm = 620 + t * 340
        p += 2 * math.pi * (rpm / 60 * 2) / RATE
        sine = math.sin(p) * 0.28 + math.sin(p * 2) * 0.12
        fire = max(0.0, math.sin(2 * math.pi * (rpm / 60 * 4) * t)) ** 12 * 0.22
        swell = env(t, 0.16, 1.7, 0.9)
        out[i] = (sine + fire + noise(i) * 0.03) * swell
    return out


def palace() -> list[float]:
    n = int(RATE * 3.0)
    out = [0.0] * n
    p = 0.0
    delay = int(RATE * 0.22)
    for i in range(n):
        t = i / RATE
        p += 2 * math.pi * 174 / RATE
        bell = (math.sin(p) + 0.32 * math.sin(p * 2.01) + 0.1 * math.sin(p * 2.99)) * env(t, 0.08, 0.4, 2.3)
        echo = out[i - delay] * 0.32 if i > delay else 0.0
        out[i] = bell * 0.55 + echo
    return out


def crown() -> list[float]:
    n = int(RATE * 2.2)
    out = [0.0] * n
    p = 0.0
    for i in range(n):
        t = i / RATE
        f = 196 if t < 0.6 else (247 if t < 1.15 else 330)
        p += 2 * math.pi * f / RATE
        out[i] = (math.sin(p) + 0.2 * math.sin(p * 2)) * env(t, 0.07, 0.35, 1.5) * 0.5
    return out


def ring() -> list[float]:
    n = int(RATE * 1.5)
    out = [0.0] * n
    p = 0.0
    for i in range(n):
        t = i / RATE
        p += 2 * math.pi * 2489 / RATE
        out[i] = (math.sin(p) + 0.18 * math.sin(p * 2.14)) * env(t, 0.001, 0.04, 1.2) * 0.5
    return out


def rose() -> list[float]:
    n = int(RATE * 1.25)
    out = [0.0] * n
    p1 = p2 = 0.0
    for i in range(n):
        t = i / RATE
        p1 += 2 * math.pi * 392 / RATE
        p2 += 2 * math.pi * 523 / RATE
        out[i] = (math.sin(p1) * 0.4 + math.sin(p2) * 0.2) * env(t, 0.05, 0.25, 0.85)
    return out


def coffee() -> list[float]:
    n = int(RATE * 1.35)
    out = [0.0] * n
    p = 0.0
    for i in range(n):
        t = i / RATE
        clink = math.sin(2 * math.pi * 1950 * t) * env(t, 0.002, 0.01, 0.12) * 0.4
        p += 2 * math.pi * 168 / RATE
        pour = math.sin(p) * env(t - 0.08, 0.1, 0.4, 0.7) * 0.28
        out[i] = clink + pour
    return out


def oud() -> list[float]:
    n = int(RATE * 1.7)
    out = [0.0] * n
    p = 0.0
    for i in range(n):
        t = i / RATE
        p += 2 * math.pi * 98 / RATE
        out[i] = math.sin(p) * env(t, 0.16, 0.5, 0.9) * 0.32 + noise(i) * env(t, 0.2, 0.4, 0.9) * 0.1
    return out


def perfume() -> list[float]:
    n = int(RATE * 1.4)
    out = [0.0] * n
    for i in range(n):
        t = i / RATE
        spray = noise(i) * env(t, 0.01, 0.12, 0.35) * 0.28
        glass = math.sin(2 * math.pi * 1650 * t) * env(t - 0.16, 0.002, 0.02, 0.2) * 0.22
        out[i] = spray + glass
    return out


def beads() -> list[float]:
    n = int(RATE * 1.7)
    out = [0.0] * n
    taps = [0.0, 0.18, 0.34, 0.52, 0.7, 0.9, 1.12]
    for i in range(n):
        t = i / RATE
        s = 0.0
        for k, at in enumerate(taps):
            u = t - at
            s += math.sin(2 * math.pi * (1320 + k * 80) * max(0.0, u)) * env(u, 0.001, 0.01, 0.07) * 0.28
        out[i] = s
    return out


def star() -> list[float]:
    n = int(RATE * 2.4)
    out = [0.0] * n
    sparks = [(0.0, 2349), (0.28, 2794), (0.55, 3136), (0.88, 2093), (1.2, 3520)]
    for i in range(n):
        t = i / RATE
        s = 0.0
        for at, f in sparks:
            u = t - at
            s += math.sin(2 * math.pi * f * max(0.0, u)) * env(u, 0.002, 0.04, 0.55) * 0.22
        out[i] = s
    return out


def main() -> None:
    write_wav("gift_falcon", falcon())
    write_wav("gift_horse", horse())
    write_wav("gift_yacht", yacht())
    write_wav("gift_car", car())
    write_wav("gift_palace", palace())
    write_wav("gift_crown", crown())
    write_wav("gift_ring", ring())
    write_wav("gift_rose", rose())
    write_wav("gift_coffee", coffee())
    write_wav("gift_oud", oud())
    write_wav("gift_perfume", perfume())
    write_wav("gift_beads", beads())
    write_wav("gift_star", star())


if __name__ == "__main__":
    main()
