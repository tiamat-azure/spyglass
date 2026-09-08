# whisper.cpp and model-weight licences

PRD §16.3 required licence compatibility of `whisper.cpp` **and** model weights
for redistribution in the Spyglass installer to be **verified and documented at
Lot -1**, before the first package build that would ship them.

Lot 3 ships the **integration path**: a localhost WebSocket sidecar that can
invoke a local `whisper-cli` + `ggml-small-q5_1.bin`. CI does **not** download
those artefacts (too heavy). Packaged/dev hosts fetch them with
`node scripts/fetch-whisper.mjs` into `vendor/whisper/` (gitignored binaries).

## Verification (2026-09-07, reaffirmed Lot 3 2026-09-08)

| Component | Licence | Source | Retrieved |
| --- | --- | --- | --- |
| `whisper.cpp` (incl. ggml sources in-tree) | **MIT** | https://github.com/ggerganov/whisper.cpp/blob/master/LICENSE | 2026-09-07 |
| OpenAI Whisper (reference implementation **and official model weights**) | **MIT** | https://github.com/openai/whisper/blob/main/LICENSE | 2026-09-07 |

Both texts are permissive MIT licences. They allow use, copy, modify, merge,
publish, distribute, sublicense, and sell, provided the copyright notice and
permission notice are included in all copies or substantial portions.

## Redistribution conclusion

Embedding a `whisper.cpp` binary and official OpenAI Whisper-derived weights
(e.g. quantized `small` multilingual, as in ADR-0013) **inside the Spyglass
installer is compatible** with these licences, as long as:

1. The MIT copyright and permission notices for `whisper.cpp` / ggml and for
   OpenAI Whisper are shipped with the application (About / licences file).
2. Third-party fine-tunes or non-official weights are **not** substituted
   without a separate licence review.
3. No additional copyleft obligation is introduced by the build toolchain used
   to compile the sidecar (verify when compiling the binary).

## Runtime (Lot 3)

- Sidecar speaks WebSocket on `127.0.0.1` only. The Electron **main** process
  is the only client (ADR-0005). The renderer sends PCM via IPC `spyglass:voice:frame`.
- Default engine is **mock** when the binary/model are missing; **whisper** when
  both exist or `SPYGLASS_STT_ENGINE=whisper`.
- `AUDIO_RETENTION=none` by default: transcripts are journaled, raw WAV is not.
