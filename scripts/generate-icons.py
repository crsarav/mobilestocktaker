#!/usr/bin/env python3
"""Rasterize StockTaker icons without third-party image libraries."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, pixels: list[list[tuple[int, int, int]]]) -> None:
    raw = b"".join(b"\x00" + bytes(c for pixel in row for c in pixel) for row in pixels)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def fill(pixels, x, y, w, h, color):
    size = len(pixels)
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(size, x + w), min(size, y + h)
    for row in range(y0, y1):
        line = pixels[row]
        for col in range(x0, x1):
            line[col] = color


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_icon(size: int):
    top, bot = (58, 24, 166), (109, 60, 255)
    white, soft = (255, 255, 255), (232, 241, 253)
    pixels = []
    for y in range(size):
        pixels.append([lerp(top, bot, y / max(size - 1, 1)) for _ in range(size)])

    def box(bx, by, bw, bh, color):
        fill(pixels, bx, by, bw, bh, color)

    s = size
    box(int(s * 0.30), int(s * 0.56), int(s * 0.40), int(s * 0.17), white)
    box(int(s * 0.35), int(s * 0.42), int(s * 0.30), int(s * 0.15), soft)
    box(int(s * 0.39), int(s * 0.29), int(s * 0.22), int(s * 0.14), white)
    return pixels


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for size in (192, 512):
        write_png(OUT / f"icon-{size}.png", size, make_icon(size))


if __name__ == "__main__":
    main()
