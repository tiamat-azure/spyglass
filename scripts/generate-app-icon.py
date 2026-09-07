#!/usr/bin/env python3
"""Write a 1024×1024 PNG app icon (cyan diaphragm on dark ground)."""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

W = H = 1024
CX = CY = 511.5
R = 336.0


def pixel(x: int, y: int) -> tuple[int, int, int, int]:
    dx = x - CX
    dy = y - CY
    dist = math.hypot(dx, dy)
    stroke = 18.0
    on_circle = abs(dist - R) <= stroke / 2
    on_blade = False
    if dist <= R + stroke:
        for k in range(6):
            ang = math.radians(k * 60)
            # segment from (32,11) to (47,28) on 64-grid, scaled
            x1 = CX + math.cos(ang) * (0) - math.sin(ang) * (11 / 21 * R - R)
            # Use rotation of the master blade around centre.
            # Master blade endpoints in 64-space: (32,11)-(47,28) centre (32,32)
            p0 = _rot(32.0, 11.0, k * 60)
            p1 = _rot(47.0, 28.0, k * 60)
            if _dist_to_segment(x / W * 64, y / H * 64, p0, p1) * (W / 64) <= stroke / 2:
                on_blade = True
                break
    if on_circle or on_blade:
        return (0x35, 0xF2, 0xFF, 255)
    return (0x06, 0x09, 0x0F, 255)


def _rot(x: float, y: float, deg: float) -> tuple[float, float]:
    rad = math.radians(deg)
    dx, dy = x - 32.0, y - 32.0
    c, s = math.cos(rad), math.sin(rad)
    return (32.0 + dx * c - dy * s, 32.0 + dx * s + dy * c)


def _dist_to_segment(
    px: float, py: float, a: tuple[float, float], b: tuple[float, float]
) -> float:
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    len2 = vx * vx + vy * vy
    t = 0.0 if len2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / len2))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def main() -> None:
    raw = bytearray()
    for y in range(H):
        raw.append(0)
        for x in range(W):
            raw.extend(pixel(x, y))
    png = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
            chunk(b"IEND", b""),
        ]
    )
    out = Path(__file__).resolve().parents[1] / "packages/app/build/icon.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png)
    print(f"wrote {out} ({len(png)} bytes)")


if __name__ == "__main__":
    main()
