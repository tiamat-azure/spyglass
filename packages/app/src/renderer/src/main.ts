const versions = document.getElementById('versions');

if (versions !== null) {
  const api = window.spyglass;
  if (api === undefined) {
    versions.textContent = 'preload bridge unavailable';
  } else {
    versions.textContent = `Electron ${api.versions.electron} · Chromium ${api.versions.chrome} · Node ${api.versions.node} · lot ${api.lot}`;
  }
}
