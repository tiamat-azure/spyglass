import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow } from 'electron';

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('no-zygote');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

const htmlPath = process.argv[2];
const outPath = process.argv[3];
if (htmlPath === undefined || outPath === undefined) {
  console.error('usage: electron screenshot-html.mjs <file.html> <out.png>');
  app.exit(1);
}

void app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    backgroundColor: '#06090F',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  await win.loadURL(pathToFileURL(htmlPath).href);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const image = await win.capturePage();
  await writeFile(outPath, image.toPNG());
  app.quit();
});
