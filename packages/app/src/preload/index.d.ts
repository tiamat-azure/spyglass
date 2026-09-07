export type SpyglassPreloadApi = {
  lot: '-1';
  versions: {
    electron: string;
    chrome: string;
    node: string;
  };
};

declare global {
  interface Window {
    spyglass: SpyglassPreloadApi;
  }
}
