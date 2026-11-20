"""Makes the gauntlet screen's sounds in boss-gauntlets/sound: python boss-gauntlets/make_sounds.py

Every sound is made here from noise and sine waves, so the mod ships no sound of the game.
    stroke.wav  a brush drawn fast across paper: one stroke of the cross over a beaten opponent
    stamp.wav   a seal pressed down: the rank on the result board
    board.wav   paper unrolled: the board opens
    drum.wav    a low drum: an opponent arrives
    reveal.wav  a soft bell tone: the next opponent shows itself
"""
import wave
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent / "sound"
RATE = 44100


def noise(rng, seconds, low, high):
    """White noise with only the frequencies between low and high (Hz)."""
    n = int(seconds * RATE)
    spectrum = np.fft.rfft(rng.standard_normal(n))
    frequency = np.fft.rfftfreq(n, 1 / RATE)
    spectrum *= np.clip((frequency - low) / (0.2 * low + 1), 0, 1) * np.clip((high - frequency) / (0.2 * high), 0, 1)
    out = np.fft.irfft(spectrum, n)
    return out / np.abs(out).max()


def envelope(seconds, attack, decay):
    """Rises within `attack` seconds, then falls with the time constant `decay` (seconds)."""
    t = np.arange(int(seconds * RATE)) / RATE
    return np.clip(t / attack, 0, 1) * np.exp(-np.clip(t - attack, 0, None) / decay)


def tone(seconds, frequency, decay, bend=0.0):
    """A sine that dies away; bend > 0 lets it start higher and fall to its frequency."""
    t = np.arange(int(seconds * RATE)) / RATE
    hertz = frequency * (1 + bend * np.exp(-t / 0.03))
    return np.sin(2 * np.pi * np.cumsum(hertz) / RATE) * np.exp(-t / decay)


def save(samples, name, loudness=0.8):
    samples = samples / np.abs(samples).max() * loudness
    n = len(samples)
    fade = min(n, int(0.01 * RATE))
    samples[-fade:] *= np.linspace(1, 0, fade)  # no click at the end
    stereo = np.repeat((samples * 32767).astype("<i2")[:, None], 2, axis=1)
    OUT.mkdir(exist_ok=True)
    with wave.open(str(OUT / name), "wb") as file:
        file.setnchannels(2)
        file.setsampwidth(2)
        file.setframerate(RATE)
        file.writeframes(stereo.tobytes())
    print(f"made {OUT / name} ({n / RATE:.2f} s)")


def stroke(rng):
    # Bristles on paper: bright noise that swells and falls, with the grain of the paper in it.
    seconds = 0.34
    t = np.arange(int(seconds * RATE)) / RATE
    swell = np.sin(np.pi * np.clip(t / 0.26, 0, 1)) ** 1.5
    grain = 0.75 + 0.25 * noise(rng, seconds, 30, 90)
    return noise(rng, seconds, 1800, 9000) * swell * grain + 0.35 * noise(rng, seconds, 300, 1200) * swell


def stamp(rng):
    # Wood on paper on a table: a short thump with a dry slap on top.
    seconds = 0.5
    return tone(seconds, 70, 0.09, bend=1.2) + 0.5 * noise(rng, seconds, 400, 3500) * envelope(seconds, 0.002, 0.025)


def board(rng):
    # A scroll unrolled: soft noise that rises and falls, darker than the brush.
    seconds = 0.7
    t = np.arange(int(seconds * RATE)) / RATE
    return noise(rng, seconds, 500, 4000) * np.sin(np.pi * t / seconds) ** 2 * (0.7 + 0.3 * noise(rng, seconds, 8, 30))


def drum(rng):
    # A large drum struck once: a low tone that falls, its skin, the stick.
    seconds = 1.6
    return (tone(seconds, 55, 0.45, bend=0.8) + 0.5 * tone(seconds, 88, 0.3, bend=0.5)
            + 0.25 * noise(rng, seconds, 80, 900) * envelope(seconds, 0.003, 0.06))


def reveal(rng):
    # A small bronze bell far away: a few partials that are not in tune with each other.
    seconds = 1.4
    partials = [(620, 1.0, 0.5), (1489, 0.45, 0.35), (2310, 0.3, 0.25), (3405, 0.15, 0.15)]
    return sum(level * tone(seconds, hertz, decay) for hertz, level, decay in partials) * envelope(seconds, 0.004, 5)


if __name__ == "__main__":
    rng = np.random.default_rng(7)
    save(stroke(rng), "stroke.wav", 0.7)
    save(stamp(rng), "stamp.wav", 0.9)
    save(board(rng), "board.wav", 0.45)
    save(drum(rng), "drum.wav", 0.9)
    save(reveal(rng), "reveal.wav", 0.5)
