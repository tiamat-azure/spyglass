# Unsigned distribution (internal v1)

Spyglass v1 is **internal-only**. Installers are **not signed** and **not
notarized** (PRD §2.3 and §16.3).

## Policy

| Platform | Target | Signing in v1 |
| --- | --- | --- |
| Linux | AppImage + deb | None |
| macOS | dmg (arm64 + x64) | `identity: null`, `notarize: false` |
| Windows | NSIS | `signAndEditExecutable: false` |

CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so electron-builder does not search
for a code-signing identity.

## Adding signatures later (no target rework)

Configuration lives in `packages/app/electron-builder.yml`.

- **macOS:** set `mac.identity` to the Developer ID Application name (or a CSC
  env var) and enable notarization with Apple credentials (`APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) when a certificate exists.
- **Windows:** set `win.certificateFile` / `certificatePassword` or
  `CSC_LINK` / `CSC_KEY_PASSWORD`. Re-enable `signAndEditExecutable`.
- **Linux:** optional GPG for the deb repo is independent of electron-builder
  targets; AppImage remains unsigned unless a separate signing step is added.

Do not change the target list (AppImage, deb, dmg x64/arm64, NSIS) when wiring
certificates.

## Known consequence

Unsigned builds may be blocked by SmartScreen, Gatekeeper, or device policy.
That is accepted for internal v1. Obtain certificates before any broader
distribution (PRD §13).
