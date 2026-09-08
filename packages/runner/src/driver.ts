export type PageSnapshot = {
  url: string;
  title: string;
  text: string;
  values: Record<string, string>;
};

export type PageDriver = {
  goto: (url: string) => Promise<void>;
  url: () => Promise<string>;
  title: () => Promise<string>;
  click: (selector: string) => Promise<void>;
  fill: (selector: string, value: string) => Promise<void>;
  select: (selector: string, value: string) => Promise<void>;
  check: (selector: string, checked: boolean) => Promise<void>;
  press: (selector: string, key: string) => Promise<void>;
  scroll: (dx: number, dy: number) => Promise<void>;
  waitFor: (selector: string, timeoutMs: number) => Promise<void>;
  isVisible: (selector: string) => Promise<boolean>;
  isAbsent: (selector: string) => Promise<boolean>;
  textContent: () => Promise<string>;
  inputValue: (selector: string) => Promise<string>;
  snapshot: () => Promise<PageSnapshot>;
  screenshot: (filePath: string) => Promise<void>;
  close: () => Promise<void>;
};
