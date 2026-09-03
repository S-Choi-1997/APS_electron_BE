const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerRoutes } = require('../automation-mail-routes');

const apiKey = 'a'.repeat(64);
const validBody = { subject: '수집 결과', body: '새 항목 3개를 찾았습니다.' };

async function fixture(t, overrides = {}) {
  const calls = [];
  const events = [];
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  registerRoutes(app, {
    env: { ZOHO_ENABLED: 'true', AUTOMATION_MAIL_API_KEY: apiKey, AUTOMATION_MAIL_TO: 'owner@example.com', ...overrides.env },
    sendNewEmail: async payload => {
      calls.push(payload);
      if (overrides.send) return overrides.send(payload);
      return { providerResult: { success: true, messageId: 'zoho-123' }, data: { id: 42 }, localSaveError: null };
    },
    broadcast: overrides.broadcast || ((...args) => events.push(args)),
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return {
    calls,
    events,
    async post(body = validBody, authorization = `Bearer ${apiKey}`) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/automation/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json(), headers: response.headers };
    },
  };
}

test('automation mail sends through the shared service to the configured owner only', async t => {
  const f = await fixture(t);
  const response = await f.post({ ...validBody, bodyHtml: '<p>수집 결과</p>' });
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, [{ ...validBody, bodyHtml: '<p>수집 결과</p>', to: ['owner@example.com'] }]);
  assert.deepEqual(response.body, { success: true, deliveryStatus: 'accepted', messageId: 'zoho-123', localSaved: true });
  assert.deepEqual(f.events, [['email:created', { id: 42 }]]);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('missing or incorrect service credentials never invoke the sender', async t => {
  const f = await fixture(t);
  for (const authorization of ['', 'Bearer wrong', `Bearer ${'b'.repeat(64)}`, `Basic ${apiKey}`]) {
    assert.equal((await f.post(validBody, authorization)).status, 401);
  }
  assert.equal(f.calls.length, 0);
});

test('incomplete configuration, short keys, multiple recipients and disabled Zoho fail closed', async t => {
  for (const env of [
    { AUTOMATION_MAIL_API_KEY: '' },
    { AUTOMATION_MAIL_API_KEY: 'short' },
    { AUTOMATION_MAIL_TO: '' },
    { AUTOMATION_MAIL_TO: 'one@example.com,two@example.com' },
    { ZOHO_ENABLED: 'false' },
  ]) {
    const f = await fixture(t, { env });
    assert.equal((await f.post()).status, 503);
    assert.equal(f.calls.length, 0);
  }
});

test('recipient overrides and unsupported payloads cannot reach the sender', async t => {
  const f = await fixture(t);
  for (const extra of [{ to: 'attacker@example.com' }, { cc: ['other@example.com'] }, { bcc: [] }, { from: 'other@example.com' }, { attachments: [] }]) {
    assert.equal((await f.post({ ...validBody, ...extra })).status, 400);
  }
  assert.equal(f.calls.length, 0);
});

test('invalid subject/body and excessive report size are rejected', async t => {
  const f = await fixture(t);
  for (const body of [[], {}, { subject: 'report' }, { ...validBody, subject: 'a\r\nb' }, { ...validBody, body: {} }, { ...validBody, subject: 'x'.repeat(501) }]) {
    assert.equal((await f.post(body)).status, 400);
  }
  assert.equal((await f.post({ subject: 'report', body: 'x'.repeat(200001) })).status, 413);
  assert.equal(f.calls.length, 0);
});

test('HTML-only reports use the existing outgoing HTML pipeline', async t => {
  const f = await fixture(t);
  assert.equal((await f.post({ subject: 'Report', bodyHtml: '<p>Result</p>' })).status, 200);
  assert.equal(f.calls[0].bodyHtml, '<p>Result</p>');
});

test('provider acceptance remains successful when local storage or notification fails', async t => {
  const f = await fixture(t, {
    send: async () => ({ providerResult: { messageId: 'sent-1' }, data: { id: 'fallback' }, localSaveError: 'private database error' }),
    broadcast: () => { throw new Error('socket failure'); },
  });
  const response = await f.post();
  assert.equal(response.status, 200);
  assert.equal(response.body.localSaved, false);
  assert.equal(response.body.warning, 'sent_but_local_save_failed');
  assert.equal(JSON.stringify(response.body).includes('private database'), false);
  assert.equal(f.calls.length, 1);
});

test('uncertain send failure is reported without retrying or exposing internal errors', async t => {
  const f = await fixture(t, { send: async () => { throw new Error('secret provider response'); } });
  const response = await f.post();
  assert.equal(response.status, 502);
  assert.deepEqual(response.body, { error: 'mail_send_unconfirmed', deliveryStatus: 'unknown', retrySafe: false });
  assert.equal(f.calls.length, 1);
  assert.equal(f.events.length, 0);
});

test('shared sender validation errors remain client errors', async t => {
  const f = await fixture(t, { send: async () => { throw Object.assign(new Error('invalid recipients'), { statusCode: 400 }); } });
  assert.equal((await f.post()).status, 400);
});

test('service rate limit stops the eleventh request before sending', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.post()).status, 200);
  const response = await f.post();
  assert.equal(response.status, 429);
  assert.ok(response.headers.get('retry-after'));
  assert.equal(f.calls.length, 10);
});
