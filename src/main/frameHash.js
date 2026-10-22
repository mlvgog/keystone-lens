'use strict';

const crypto = require('crypto');

/**
 * SHA-256 (base64) of the first inline <script> of an HTML page, as CSP 'sha256-...' expects.
 * The HTML parser turns CRLF into LF before hashing, so the same is done here.
 */
function frameScriptHash(html) {
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('No inline script found');
  return crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n'), 'utf8').digest('base64');
}

module.exports = { frameScriptHash };
