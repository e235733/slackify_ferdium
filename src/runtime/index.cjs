'use strict';
// CommonJS entry bundled into dist/.fs-runtime.cjs. Ferdium passes (config, userscript); neither is used.
const { boot } = require('./entry.js');

module.exports = function ferdiumGchatSlackify() {
  return boot({ document: globalThis.document, window: globalThis.window });
};
module.exports.boot = boot;
