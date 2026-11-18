const { app, BrowserWindow, globalShortcut, session } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { exec } = require('child_process');

// Register custom deep link protocol: edushield://open
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('edushield', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('edushield');
}

// Single instance lock: Focus window if opened again from website
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// Dedicated screen recorders to detect and alert
const RECORDER_PROCESSES = [
  'obs64', 'obs32', 'bdcam', 'camtasia', 'CamRecorder',
  'ShareX', 'bandicam', 'loom', 'snagit32', 'snagit64',
  'fraps', 'captura', 'FlashBack', 'hypercam', 'movavi', 'icecream'
];

let win = null;
let currentActiveRecorder = null;
let recorderCheckTimer = null;
let internalServer = null;

// Lightweight robust internal HTTP server to serve built Angular dist & proxy /api to ASP.NET Core
function startLocalServer(distPath, apiPort = 5078) {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.map': 'application/json'
  };

  const server = http.createServer((req, res) => {
    // 1. Proxy /api/* to ASP.NET Core backend with automatic IPv4/IPv6 fallback
    if (req.url.startsWith('/api/')) {
      const isBodyMethod = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH';
      let bodyBuffers = [];

      function executeProxy(targetHost) {
        const fullBody = isBodyMethod && bodyBuffers.length > 0 ? Buffer.concat(bodyBuffers) : null;
        const reqHeaders = { ...req.headers, host: `${targetHost}:${apiPort}` };
        reqHeaders.origin = `http://${targetHost}:${apiPort}`;
        reqHeaders.referer = `http://${targetHost}:${apiPort}/`;
        if (fullBody) {
          reqHeaders['content-length'] = fullBody.length;
        }

        const options = {
          hostname: targetHost,
          port: apiPort,
          path: req.url,
          method: req.method,
          headers: reqHeaders
        };

        const proxyReq = http.request(options, (proxyRes) => {
          console.log(`[API Proxy] ${req.method} ${req.url} -> ${proxyRes.statusCode}`);
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          if (targetHost === '127.0.0.1') {
            console.log(`[EduShield Proxy] 127.0.0.1 failed (${err.code}). Trying localhost...`);
            executeProxy('localhost');
            return;
          }
          console.error(`[API Proxy Offline] ${req.method} ${req.url} -> ${err.message}`);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Backend API is offline on port ${apiPort}. Make sure start-backend.bat is running.` }));
        });

        if (fullBody) {
          proxyReq.end(fullBody);
        } else if (isBodyMethod) {
          req.pipe(proxyReq);
        } else {
          proxyReq.end();
        }
      }

      if (isBodyMethod) {
        req.on('data', chunk => bodyBuffers.push(chunk));
        req.on('end', () => executeProxy('127.0.0.1'));
      } else {
        executeProxy('127.0.0.1');
      }
      return;
    }

    // 2. Serve static Angular frontend files
    let urlClean = req.url.split('?')[0];
    if (urlClean === '/' || urlClean === '') urlClean = '/index.html';
    let safePath = path.normalize(decodeURI(urlClean)).replace(/^(\.\.[\/\\])+/, '');
    if (safePath.startsWith('\\') || safePath.startsWith('/')) safePath = safePath.slice(1);
    
    let filePath = path.join(distPath, safePath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distPath, 'index.html');
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      console.log(`[EduShield] Internal secure server running on http://127.0.0.1:${port}`);
      resolve({ port, server });
    });
  });
}

// Quick probe if dev server is up (500ms timeout)
function checkUrl(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => resolve(res.statusCode === 200 || res.statusCode === 304));
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'EduShield Secure Desktop Player — 100% Anti-Record Protected',
    backgroundColor: '#0b1524',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true
    }
  });

  // =========================================================================
  // HARDWARE PROTECTION: Calls SetWindowDisplayAffinity(hwnd, WDA_MONITOR)
  // This physically forces Windows DWM to black out the window in:
  // - Windows Snipping Tool (Win+Shift+S / Win+Shift+R)
  // - OBS Studio (Display Capture & Window Capture)
  // - Discord, Zoom, Teams, Google Meet screen sharing
  // =========================================================================
  win.setContentProtection(true);
  win.removeMenu();

  // Forward renderer console logs to terminal for clean debugging
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message}`);
  });

  // Block ALL extensions from loading at network level
  try {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['chrome-extension://*/*'] },
      (details, callback) => callback({ cancel: true })
    );
  } catch (err) {
    console.warn('[EduShield] Extension filter warning:', err.message);
  }

  win.webContents.on('did-fail-load', (e, code, desc, url) => {
    console.error(`[Load Error] Failed to load ${url} (${code}: ${desc})`);
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Determine target URL: dev server (localhost:4200) or internal static server
  const isDevRunning = await checkUrl('http://127.0.0.1:4200');
  if (isDevRunning) {
    console.log('[EduShield] Connecting to active Angular dev server at http://localhost:4200');
    win.loadURL('http://localhost:4200');
  } else {
    const distPath = path.resolve(__dirname, '..', 'frontend', 'dist', 'edu-shield-web', 'browser');
    console.log(`[EduShield] Serving built frontend from: ${distPath}`);
    const { port, server } = await startLocalServer(distPath);
    internalServer = server;
    win.loadURL(`http://127.0.0.1:${port}`);
  }

  // Active Background Process Monitoring for Screen Recorders
  startRecorderProcessWatcher();

  win.on('closed', () => {
    if (recorderCheckTimer) clearInterval(recorderCheckTimer);
    if (internalServer) internalServer.close();
    win = null;
  });
}

function startRecorderProcessWatcher() {
  recorderCheckTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;

    const names = RECORDER_PROCESSES.join(',');
    const cmd = `powershell -NoProfile -Command "Get-Process -Name ${names} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName"`;

    exec(cmd, { windowsHide: true, timeout: 2000 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) {
        if (currentActiveRecorder) {
          console.log(`[EduShield] Recorder ${currentActiveRecorder} closed. Releasing blackout.`);
          currentActiveRecorder = null;
          try {
            win.webContents.send('recorder-status', { running: false });
            win.webContents.setAudioMuted(false);
          } catch {}
        }
        return;
      }

      const detected = stdout.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (detected.length > 0) {
        const recorderName = detected[0];
        if (currentActiveRecorder !== recorderName) {
          console.log(`[EduShield] Screen recorder DETECTED: ${recorderName}. Locking screen to black.`);
          currentActiveRecorder = recorderName;
        }
        try {
          win.webContents.send('recorder-status', { running: true, name: recorderName });
          win.webContents.setAudioMuted(true);
        } catch {}
      } else {
        if (currentActiveRecorder) {
          currentActiveRecorder = null;
          try {
            win.webContents.send('recorder-status', { running: false });
            win.webContents.setAudioMuted(false);
          } catch {}
        }
      }
    });
  }, 2500);
}

app.whenReady().then(() => {
  createWindow().catch((err) => {
    console.error('[EduShield Fatal Error in createWindow]:', err);
  });

  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.toggleDevTools();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (recorderCheckTimer) clearInterval(recorderCheckTimer);
  if (internalServer) internalServer.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
