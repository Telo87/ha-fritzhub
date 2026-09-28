"""Make answering machine recordings playable in every browser.

FRITZ!Box recordings are WAV files that may use G.711 µ-law/A-law encoding,
which not all browsers can play. Those are converted to 16 bit PCM here
(pure Python, no ffmpeg needed).
"""

from __future__ import annotations

import struct
from array import array


def _ulaw(value: int) -> int:
    value = ~value & 0xFF
    sign, exponent, mantissa = value & 0x80, (value >> 4) & 0x07, value & 0x0F
    sample = (((mantissa << 3) + 0x84) << exponent) - 0x84
    return -sample if sign else sample


def _alaw(value: int) -> int:
    value ^= 0x55
    t = (value & 0x0F) << 4
    seg = (value & 0x70) >> 4
    if seg == 0:
        t += 8
    elif seg == 1:
        t += 0x108
    else:
        t = (t + 0x108) << (seg - 1)
    return t if value & 0x80 else -t


_TABLES = {
    6: [_alaw(i) for i in range(256)],
    7: [_ulaw(i) for i in range(256)],
}


def to_playable_wav(data: bytes) -> tuple[bytes, str]:
    """Return ``(audio, mime_type)``."""
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        return data, "application/octet-stream"

    pos, fmt, payload = 12, None, None
    while pos + 8 <= len(data):
        cid, size = data[pos : pos + 4], struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        body = data[pos + 8 : pos + 8 + size]
        if cid == b"fmt ":
            fmt = struct.unpack("<HHIIHH", body[:16])
        elif cid == b"data":
            payload = body
        pos += 8 + size + (size & 1)

    if not fmt or payload is None or fmt[0] not in _TABLES:
        return data, "audio/wav"

    _, channels, rate, *_ = fmt
    table = _TABLES[fmt[0]]
    pcm = array("h", (table[b] for b in payload)).tobytes()
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + len(pcm),
        b"WAVE",
        b"fmt ",
        16,
        1,
        channels,
        rate,
        rate * channels * 2,
        channels * 2,
        16,
        b"data",
        len(pcm),
    )
    return header + pcm, "audio/wav"
