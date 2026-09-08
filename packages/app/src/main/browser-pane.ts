import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type BrowserWindow, type WebContents, WebContentsView } from 'electron';
import type { BrowserBounds, NavState, PopupRedirectedPayload } from '../shared/ipc.ts';
import { BROWSER_PARTITION } from '../shared/ipc.ts';
import { isGuestRequestToCdpPort } from './cdp-loopback.ts';
import { isAllowedInViewNavigation, isAllowedPopupRedirect } from './nav-url.ts';

export type BrowserPaneHandlers = {
  onState: (state: NavState) => void;
  onPopupRedirected: (payload: PopupRedirectedPayload) => void;
};

export type BrowserPaneOptions = {
  cdpPort?: number;
};

function guestStartPagePath(): string {
  const requested = process.env.SPYGLASS_GUEST_PAGE;
  const name =
    requested !== undefined && /^[A-Za-z0-9._-]+\.html$/.test(requested) ? requested : 'start.html';
  const candidates = [
    join(import.meta.dirname, `../resources/${name}`),
    join(import.meta.dirname, `../../resources/${name}`)
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Lot 1 guest page is missing (resources/${name})`);
}

export class BrowserPane {
  readonly view: WebContentsView;
  private readonly handlers: BrowserPaneHandlers;

  constructor(win: BrowserWindow, handlers: BrowserPaneHandlers, options?: BrowserPaneOptions) {
    this.handlers = handlers;
    this.view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: BROWSER_PARTITION,
        backgroundThrottling: false
      }
    });
    win.contentView.addChildView(this.view);
    this.attachNavigation();
    this.attachSchemeGuard();
    this.attachCdpPortBlock(options?.cdpPort ?? 0);
    // Replaces the C1 deny-all window.open default with F-04 in-view redirect.
    this.attachPopupRedirect();
  }

  get webContents(): WebContents {
    return this.view.webContents;
  }

  get resourcesDir(): string {
    return this.guestResourcesDir();
  }

  setBounds(bounds: BrowserBounds): void {
    this.view.setBounds(bounds);
  }

  /** W-08: hide the guest without resizing it (must not trip page media queries). */
  setVisible(visible: boolean): void {
    this.view.setVisible(visible);
  }

  async loadStartPage(): Promise<void> {
    await this.webContents.loadFile(guestStartPagePath());
  }

  async goto(url: string): Promise<void> {
    await this.webContents.loadURL(url);
  }

  back(): void {
    if (this.webContents.navigationHistory.canGoBack()) {
      this.webContents.navigationHistory.goBack();
    }
  }

  forward(): void {
    if (this.webContents.navigationHistory.canGoForward()) {
      this.webContents.navigationHistory.goForward();
    }
  }

  reload(): void {
    this.webContents.reload();
  }

  snapshot(): NavState {
    return {
      url: this.webContents.getURL(),
      title: this.webContents.getTitle(),
      loading: this.webContents.isLoading(),
      canGoBack: this.webContents.navigationHistory.canGoBack(),
      canGoForward: this.webContents.navigationHistory.canGoForward()
    };
  }

  private emitState(): void {
    this.handlers.onState(this.snapshot());
  }

  private attachNavigation(): void {
    const contents = this.webContents;
    contents.on('did-start-loading', () => {
      this.emitState();
    });
    contents.on('did-stop-loading', () => {
      this.emitState();
    });
    contents.on('did-navigate', () => {
      this.emitState();
    });
    contents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
      if (isMainFrame) {
        this.emitState();
      }
    });
    contents.on('page-title-updated', () => {
      this.emitState();
    });
    contents.on('did-fail-load', () => {
      this.emitState();
    });
  }

  private guestResourcesDir(): string {
    return dirname(guestStartPagePath());
  }

  private attachSchemeGuard(): void {
    const contents = this.webContents;
    const denyIfDisallowed = (
      event: { url: string; preventDefault: () => void },
      isMainFrame: boolean
    ): void => {
      if (
        !isAllowedInViewNavigation(
          contents.getURL(),
          event.url,
          this.guestResourcesDir(),
          isMainFrame
        )
      ) {
        event.preventDefault();
      }
    };
    contents.on('will-navigate', (event) => {
      denyIfDisallowed(event, true);
    });
    contents.on('will-frame-navigate', (event) => {
      denyIfDisallowed(event, event.isMainFrame);
    });
    // HTTP(S) 3xx redirects skip will-navigate; still enforce the scheme guard.
    contents.on('will-redirect', (event) => {
      denyIfDisallowed(event, event.isMainFrame);
    });
  }

  private attachCdpPortBlock(cdpPort: number): void {
    if (cdpPort <= 0) {
      return;
    }
    const ses = this.webContents.session;
    ses.webRequest.onBeforeRequest((details, callback) => {
      if (isGuestRequestToCdpPort(details.url, cdpPort)) {
        callback({ cancel: true });
        return;
      }
      callback({});
    });
  }

  private attachPopupRedirect(): void {
    this.webContents.setWindowOpenHandler((details) => {
      const url = details.url;
      this.handlers.onPopupRedirected({
        url,
        source:
          details.disposition === 'foreground-tab' || details.disposition === 'background-tab'
            ? 'target=_blank'
            : 'window.open'
      });
      if (isAllowedPopupRedirect(this.webContents.getURL(), url, this.guestResourcesDir())) {
        void this.webContents.loadURL(url);
      }
      return { action: 'deny' };
    });
  }
}
