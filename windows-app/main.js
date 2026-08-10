'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, session } = require('electron');

let server;
let mainWindow;

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '显示',
      submenu: [
        { role: 'reload', label: '重新载入' },
        { role: 'toggleDevTools', label: '开发者工具', visible: false }
      ]
    }
  ]));
}

async function createWindow() {
  const tools = path.join(process.resourcesPath, 'tools');
  process.env.SONORA_YTDLP = path.join(tools, 'yt-dlp.exe');
  process.env.SONORA_FFMPEG = path.join(tools, 'ffmpeg.exe');

  ({ server } = require(path.join(__dirname, 'app', 'server.js')));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const localUrl = `http://127.0.0.1:${address.port}`;

  mainWindow = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 620,
    minHeight: 560,
    title: 'Youtube 音频提取',
    backgroundColor: '#f7f7f5',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  session.defaultSession.on('will-download', async (_event, item) => {
    item.pause();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '保存音频',
      defaultPath: path.join(app.getPath('downloads'), item.getFilename())
    });
    if (result.canceled || !result.filePath) {
      item.cancel();
      return;
    }
    item.setSavePath(result.filePath);
    item.resume();
  });

  installMenu();
  await mainWindow.loadURL(localUrl);
}

app.whenReady().then(createWindow).catch(error => {
  dialog.showErrorBox('Sonora 启动失败', error.stack || error.message);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (server?.listening) server.close();
});
