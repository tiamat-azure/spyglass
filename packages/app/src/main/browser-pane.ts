import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserWindow, type WebContents, WebContentsView } from 'electron';
import type { BrowserBounds, NavState, PopupRedirectedPayload } from '../shared/ipc.ts';
import { BROWSER_PARTITION } from '../shared/ipc.ts';
import { isAllowedGuestUrl } from './nav-url.ts';

export type BrowserPaneHandlers = {
  onState: (state: NavState) => void;
  onPopupRedirected: (payload: PopupRedirectedPayload) => void;
};

function guestStartPagePath(): string {
  const candidates = [
    join(import.meta.dirname, '../resources/start.html'),
    join(import.meta.dirname, '../../resources/start.html')
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error('Lot 0 start page is missing (resources/start.html)');
}

export class BrowserPane {
  readonly view: WebContentsView;
  private readonly handlers: BrowserPaneHandlers;

  constructor(win: BrowserWindow, handlers: BrowserPaneHandlers) {
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
    this.attachPopupRedirect();
  }

  get webContents(): WebContents {
    return this.view.webContents;
  }

  setBounds(bounds: BrowserBounds): void {
    this.view.setBounds(bounds);
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
      if (isAllowedGuestUrl(url) && url !== 'about:blank') {
        void this.webContents.loadURL(url);
      }
      return { action: 'deny' };
    });
  }
}
