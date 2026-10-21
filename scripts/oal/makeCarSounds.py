# One Africa Life: the town's vehicles' sounds (public/oal/sounds/), cut from the owner's
# recordings (art-src/one-africa-life/cars/sounds, Pixabay and Freesound): the engine starting,
# idling and driving, the doors opening and shutting, the horn, the tyres screeching, a crash, the
# police siren, the town's traffic far off. Loops as WAV (no encoder's silence at their ends:
# they go round without a click), their ends crossfaded into their starts; the rest as MP3.
#
#   python3 scripts/oal/makeCarSounds.py <recordings dir> <out dir>
import os
import subprocess
import sys
import wave

import numpy as np

SRC, OUT = sys.argv[1:3]
os.makedirs(OUT, exist_ok=True)
RATE = 24000


def load(name):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(SRC, name), '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def cut(a, t0, t1):
    return a[int(t0 * RATE):int(t1 * RATE)].copy()


def fade(a, fin=0.01, fout=0.03):
    n_in = int(fin * RATE)
    n_out = int(fout * RATE)
    if n_in:
        a[:n_in] *= np.linspace(0, 1, n_in)
    if n_out:
        a[-n_out:] *= np.linspace(1, 0, n_out)
    return a


def loop(a, cross=0.6):
    """A loop: its last moments crossfaded into its first (so it goes round with no seam)."""
    n = int(cross * RATE)
    head = a[:n]
    tail = a[-n:]
    w = np.linspace(0, 1, n)
    out = a[n:-n].copy() if len(a) > 3 * n else a.copy()
    joined = tail * (1 - w) + head * w
    return np.concatenate([joined, out])


def level(a, peak=0.89):
    m = np.max(np.abs(a)) or 1
    return a * (peak / m)


def write_wav(name, a):
    pcm = (np.clip(a, -1, 1) * 32767).astype('<i2')
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    print(name, f'{len(a) / RATE:.1f}s', os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')


def write_mp3(name, a):
    tmp = os.path.join(OUT, '_tmp.f32')
    a.astype('<f4').tofile(tmp)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', tmp, '-b:a', '128k', os.path.join(OUT, name)], check=True)
    os.remove(tmp)
    print(name, f'{len(a) / RATE:.1f}s', os.path.getsize(os.path.join(OUT, name)) // 1024, 'KB')


start = load('freesound_community-car-engine-start-44357.mp3')
write_mp3('engine-start.mp3', level(fade(cut(start, 0.0, 3.2), 0.005, 0.5)))
write_wav('engine-idle.wav', level(loop(cut(start, 3.4, 10.4))))
driving = load('freesound_community-driving-in-a-car-6227.mp3')
write_wav('engine-drive.wav', level(loop(cut(driving, 6.0, 30.0), 1.0)))
door = load('freesound_community-car-door-opening-and-closing-106177.mp3')
write_mp3('door-open.mp3', level(fade(cut(door, 0.25, 1.5))))
write_mp3('door-close.mp3', level(fade(cut(door, 1.75, 3.0))))
horn = load('freesound_community-car-horn-6408.mp3')
write_mp3('horn.mp3', level(fade(cut(horn, 0.55, 3.3), 0.01, 0.15)))
screech = load('freesound_community-nissan-maxima-handbrake-turn-04-25-2009-6098.mp3')
write_mp3('screech.mp3', level(fade(cut(screech, 4.8, 7.6), 0.02, 0.3)))
crash = load('dragon-studio-car-crash-sound-effect-376874.mp3')
write_mp3('crash.mp3', level(fade(crash, 0.002, 0.2)))
siren = load('dragon-studio-police-siren-397963.mp3')
write_wav('siren.wav', level(loop(siren, 0.4)))
city = load('freesound_community-city-traffic-outdoor-6414.mp3')
write_wav('traffic.wav', level(loop(cut(city, 2.0, 32.0), 1.5), 0.6))
