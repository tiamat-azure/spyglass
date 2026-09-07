/**
 * Chromium `--remote-allow-origins` (W2). Empty string, never `*`.
 *
 * Chromium 111+ rejects a DevTools WebSocket only when the request has an
 * `Origin` header that is not on this allowlist. Playwright/Stagehand Node
 * clients omit `Origin`, so Observe still connects. Browser-origin CDP
 * (devtools frontend, DNS-rebinding pages) is denied.
 */
export const CDP_REMOTE_ALLOW_ORIGINS = '';
