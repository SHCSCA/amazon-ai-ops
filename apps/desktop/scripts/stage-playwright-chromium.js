const fs = require('node:fs');
const path = require('node:path');

function assertSafeStagingRoot(stagingRoot) {
  const resolved = path.resolve(stagingRoot);
  if (path.basename(resolved).toLowerCase() !== 'playwright-browsers') {
    throw new Error(`Refusing to replace unexpected Chromium staging directory: ${resolved}`);
  }
  return resolved;
}

function chromiumRevisionFromExecutable(sourceExecutablePath) {
  const revisionDirectory = path.basename(path.dirname(path.dirname(sourceExecutablePath)));
  const match = /^chromium-(\d+)$/i.exec(revisionDirectory);
  if (!match) {
    throw new Error(`Playwright Chromium executable is outside a revision directory: ${sourceExecutablePath}`);
  }
  return match[1];
}

function summarizeDirectory(root) {
  let fileCount = 0;
  let sizeBytes = 0;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(entryPath);
        fileCount += 1;
        sizeBytes += stat.size;
      } else {
        throw new Error(`Unsupported Playwright Chromium runtime entry: ${entryPath}`);
      }
    }
  };
  visit(root);
  return { fileCount, sizeBytes };
}

function stagePlaywrightChromiumRuntime({ sourceExecutablePath, stagingRoot }) {
  const resolvedExecutablePath = path.resolve(sourceExecutablePath);
  if (!fs.existsSync(resolvedExecutablePath) || path.basename(resolvedExecutablePath).toLowerCase() !== 'chrome.exe') {
    throw new Error(
      `Playwright Chromium is not installed at ${resolvedExecutablePath}. `
      + 'Run "pnpm --filter @amazon-ai-ops/desktop exec playwright install chromium" and rebuild.',
    );
  }

  const sourceDirectory = path.dirname(resolvedExecutablePath);
  if (path.basename(sourceDirectory).toLowerCase() !== 'chrome-win64') {
    throw new Error(`Unexpected Playwright Chromium runtime directory: ${sourceDirectory}`);
  }

  const resolvedStagingRoot = assertSafeStagingRoot(stagingRoot);
  const stagedRuntimeDirectory = path.join(resolvedStagingRoot, 'chrome-win64');
  fs.rmSync(resolvedStagingRoot, { recursive: true, force: true });
  fs.mkdirSync(resolvedStagingRoot, { recursive: true });
  fs.cpSync(sourceDirectory, stagedRuntimeDirectory, { recursive: true, force: true });

  const stagedExecutablePath = path.join(stagedRuntimeDirectory, 'chrome.exe');
  if (!fs.existsSync(stagedExecutablePath)) {
    throw new Error(`Staged Playwright Chromium executable is missing: ${stagedExecutablePath}`);
  }

  return {
    revision: chromiumRevisionFromExecutable(resolvedExecutablePath),
    stagedExecutablePath,
    ...summarizeDirectory(stagedRuntimeDirectory),
  };
}

function main() {
  const { chromium } = require('playwright');
  const result = stagePlaywrightChromiumRuntime({
    sourceExecutablePath: chromium.executablePath(),
    stagingRoot: path.join(__dirname, '..', 'playwright-browsers'),
  });
  console.log(
    `Staged Playwright Chromium revision ${result.revision}: `
    + `${result.fileCount} files / ${result.sizeBytes} bytes`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  stagePlaywrightChromiumRuntime,
};
