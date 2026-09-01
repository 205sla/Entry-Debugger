'use strict';

const fs = require('fs');
const path = require('path');

// Chrome Web Store와 개발용 빌드에 포함할 production 파일의 단일 allowlist.
// 새 런타임 파일을 추가할 때 manifest와 함께 이 목록도 명시적으로 갱신한다.
const PRODUCTION_FILES = Object.freeze([
  'background.js',
  'block-text-copy.js',
  'boost-mode.js',
  'console-debugging.js',
  'content.js',
  'dropdown-search.js',
  'entry-adapter.js',
  'frame-profiler.js',
  'function-library-templates.js',
  'function-private-variables.js',
  'function-usage-inspector.js',
  'hangul-search.js',
  'high-quality-block-image.js',
  'icon128.png',
  'icon48.png',
  'inject.js',
  'manifest.json',
  'page-bridge.js',
  'patch-registry.js',
  'picture-tools.js',
  'popup.html',
  'popup.js',
  'settings.js',
  'single-block-drag.js',
  'style.css',
  'turbo-mode.js'
]);

function copyProductionFiles(sourceDir, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  PRODUCTION_FILES.forEach((relativePath) => {
    const sourcePath = path.join(sourceDir, relativePath);
    const targetPath = path.join(targetDir, relativePath);
    if (!fs.statSync(sourcePath).isFile()) {
      throw new Error('Production extension file is missing: ' + relativePath);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  });
}

module.exports = {
  PRODUCTION_FILES,
  copyProductionFiles
};
