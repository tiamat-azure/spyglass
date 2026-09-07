/**
 * Chromium remote debugging must be enabled before `app.ready`. Packaged builds
 * leave it off unless the operator opts in. Unpackaged / electron-vite runs
 * keep it on so `pnpm start`, `pnpm dev`, and e2e still attach Stagehand.
 */
export function isRemoteDebuggingRequested(
  env: NodeJS.ProcessEnv = process.env,
  packaged = false
): boolean {
  if (env.SPYGLASS_CDP === '0') {
    return false;
  }
  if (env.SPYGLASS_CDP === '1') {
    return true;
  }
  if (env.SPYGLASS_OBSERVE_ON_START === '1') {
    return true;
  }
  const rendererUrl = env.ELECTRON_RENDERER_URL;
  if (rendererUrl !== undefined && rendererUrl.length > 0) {
    return true;
  }
  return !packaged;
}
