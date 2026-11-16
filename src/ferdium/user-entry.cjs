'use strict';
// FERDIUM-SLACKIFY-MANAGED (user.js wrapper). Managed by ferdium-gchat-slackify. Runs the pre-existing user.js (kept as
// .fs-original-user.cjs, if there was one) exactly once, then the Slackify runtime.
const fs = require('fs');
const path = require('path');

module.exports = function (config, userscript) {
  const original = path.join(__dirname, '.fs-original-user.cjs');
  if (fs.existsSync(original)) {
    try {
      const mod = require(original);
      if (typeof mod === 'function') mod(config, userscript);
    } catch (e) {
      console.error('[ferdium-gchat-slackify] original user.js failed:', e && e.name);
    }
  }
  try {
    require(path.join(__dirname, '.fs-runtime.cjs'))(config, userscript);
  } catch (e) {
    console.error('[ferdium-gchat-slackify] runtime failed:', e && e.name);
  }
};
