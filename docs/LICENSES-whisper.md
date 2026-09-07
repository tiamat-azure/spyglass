# whisper.cpp and model-weight licences (Lot -1)

PRD §16.3 requires licence compatibility of `whisper.cpp` **and** model weights
for redistribution in the Spyglass installer to be **verified and documented at
Lot -1**, before the first package build that would ship them.

This lot does **not** bundle the sidecar binary or weights. Packaging those
artefacts is a later-lot concern (ADR-0013, Lot 3). The check below is the
redistribution gate.

## Verification (2026-09-07)

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
   to compile the sidecar (verify at the lot that compiles the binary).

## Out of scope here

- Compiling per-platform `whisper.cpp` binaries
- Downloading or vendoring `.gguf` / ggml weights
- Runtime sidecar process (WebSocket from the Electron main process)

Those land with the STT lot. `@spyglass/stt` is a package scaffold only.
