import { app, type Session, session, type WebContents } from 'electron';
import { allowPermission, denyWindowOpenHandler } from './web-security.ts';

const hardenedSessions = new WeakSet<Session>();

export function installWebContentsSecurityDefaults(): void {
  app.on('session-created', (ses) => {
    hardenSession(ses);
  });
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
    // Default: deny new windows. BrowserPane replaces this for F-04 redirect.
    contents.setWindowOpenHandler(() => denyWindowOpenHandler());
    hardenSession(contents.session);
  });
  void app
    .whenReady()
    .then(() => {
      hardenSession(session.defaultSession);
    })
    .catch((error: unknown) => {
      console.error('Failed to harden default session:', error);
    });
}

function hardenSession(ses: Session): void {
  if (hardenedSessions.has(ses)) {
    return;
  }
  hardenedSessions.add(ses);
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const isChrome = contents.session === session.defaultSession;
    const mediaTypes =
      'mediaTypes' in details && Array.isArray(details.mediaTypes) ? details.mediaTypes : undefined;
    callback(allowPermission({ isChrome, permission, mediaTypes }));
  });
  ses.setPermissionCheckHandler((contents, permission, _requestingOrigin, details) => {
    if (contents === undefined || contents === null) {
      return false;
    }
    const isChrome = contents.session === session.defaultSession;
    const mediaType =
      details !== undefined && 'mediaType' in details && typeof details.mediaType === 'string'
        ? details.mediaType
        : undefined;
    return allowPermission({ isChrome, permission: String(permission), mediaType });
  });
}
