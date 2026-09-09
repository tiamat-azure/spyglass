# whisper.cpp binaries and ggml weights (Lot 3)

This directory is **optional at checkout**. CI uses the mock STT engine.

To enable the real local engine (ADR-0013) for packaged/dev:

```bash
node scripts/fetch-whisper.mjs
```

That writes:

- `whisper-cli` (or `whisper-cli.exe`) — prebuilt whisper.cpp
  (Linux/Windows). **Darwin skips CLI ensure (D34a):** ggml-org Darwin
  assets are an xcframework, not a Unix `whisper-cli`. Build whisper.cpp
  locally and copy `whisper-cli` here if needed.
- `ggml-small-q5_1.bin` — quantized multilingual `small` (~190 MB)

`node scripts/fetch-whisper.mjs --large` also leaves `ggml-small-q5_1.bin`
(F-39 fallback) and, on Linux/Windows, `whisper-cli` / `whisper-cli.exe`
(C26a). Darwin still skips CLI ensure (D34a).

Weights are **not** committed. Licences: `docs/LICENSES-whisper.md`.
