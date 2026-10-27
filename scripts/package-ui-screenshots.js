// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    fs,
    path,
  } = dependencies;
  const fail = (...args) => dependencies.fail(...args);
  const sha256Buffer = (...args) => dependencies.sha256Buffer(...args);

function readPngDimensions(buffer) {
  const pngSignature = '89504e470d0a1a0a';
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function screenshotRecord(filePath, extra = {}) {
  const buffer = fs.readFileSync(filePath);
  return {
    ...extra,
    path: filePath,
    sha256: sha256Buffer(buffer),
    dimensions: readPngDimensions(buffer),
    sizeBytes: buffer.length,
  };
}

async function captureViewportScreenshot(electronApp, screenshotPath) {
  const capture = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      throw new Error('No live packaged BrowserWindow is available for evidence capture.');
    }
    const image = await window.webContents.capturePage();
    return {
      data: image.toPNG().toString('base64'),
      empty: image.isEmpty(),
      nativeSize: image.getSize(),
    };
  });
  if (capture?.empty || !capture?.data) {
    fail('Electron webContents.capturePage returned no PNG payload', screenshotPath);
  }
  fs.writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'));
  const dimensions = readPngDimensions(fs.readFileSync(screenshotPath));
  if (!dimensions) fail('Electron webContents.capturePage did not produce a valid PNG', screenshotPath);
  return {
    dimensions,
    method: 'electron-webcontents-capture-page',
    nativeSize: capture.nativeSize,
  };
}

function timestampSegment(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function safeSegment(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

  return {
    readPngDimensions,
    screenshotRecord,
    captureViewportScreenshot,
    timestampSegment,
    safeSegment,
  };
};
