const test = require('node:test');
const assert = require('node:assert/strict');
const { applyInlineImageUrls } = require('../zoho/send');

test('replaces pasted data image with Zoho inline upload URL', () => {
  const dataUrl = 'data:image/png;base64,aGVsbG8=';
  const html = `<p>Hello</p><img src="${dataUrl}">`;
  const result = applyInlineImageUrls(html, [{
    source: { inline: true, dataUrl },
    uploaded: { url: '/zm/ImageSignature?fileName=image.png' },
  }]);
  assert.equal(result.includes(dataUrl), false);
  assert.match(result, /\/zm\/ImageSignature\?fileName=image\.png/);
});
