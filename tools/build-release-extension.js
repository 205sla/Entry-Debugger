'use strict';

const path = require('path');
const { PRODUCTION_FILES, copyProductionFiles } = require('./extension-files');

const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'entry-debugger-extension');
const targetDir = path.join(rootDir, 'dist', 'entry-debugger-extension-release');

copyProductionFiles(sourceDir, targetDir);

console.log('[build-release-extension] Wrote ' + targetDir);
console.log('[build-release-extension] Included ' + PRODUCTION_FILES.length + ' allowlisted files.');
