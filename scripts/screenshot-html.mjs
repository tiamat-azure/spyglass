import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('no-zygote');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

function main() {
  const htmlArg = process.argv[2];
  const outArg = process.argv[3];
  if (htmlArg === undefined || outArg === undefined) {
    console.error('usage: electron screenshot-html.mjs <file.html> <out.png>');
    app.exit(1);
    return;
  }

  const htmlPath = resolve(htmlArg);
  const outPath = resolve(outArg);

  void app
    .whenReady()
    .then(async () => {
      const win = new BrowserWindow({
        width: 1100,
        height: 720,
        show: false,
        backgroundColor: '#06090F',
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
      });
      await win.loadURL(pathToFileURL(htmlPath).href);
      await new Promise((resolveReady) => setTimeout(resolveReady, 250));
      const image = await win.capturePage();
      await writeFile(outPath, image.toPNG());
      app.quit();
    })
    .catch((error) => {
      console.error('screenshot-html failed:', error);
      app.exit(1);
    });
}

main();
