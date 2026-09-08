# whisper.cpp binaries and ggml weights (Lot 3)

This directory is **optional at checkout**. CI uses the mock STT engine.

To enable the real local engine (ADR-0013) for packaged/dev:

```bash
node scripts/fetch-whisper.mjs
```

That writes:

- `whisper-cli` (or `whisper-cli.exe`) — prebuilt whisper.cpp
- `ggml-small-q5_1.bin` — quantized multilingual `small` (~190 MB)

Weights are **not** committed. Licences: `docs/LICENSES-whisper.md`.
