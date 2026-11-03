import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

async function withServer(fn) {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('health endpoint clearly identifies this as a non-production prototype', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, 'prototype');
    assert.equal(data.payments, 'not-integrated');
    assert.equal(data.authentication, 'not-integrated');
  });
});

test('root serves the Arabic RTL application shell', async () => {
  await withServer(async base => {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /lang="ar" dir="rtl"/);
    assert.match(html, /ZAFFA/);
  });
});

test('unknown paths return 404', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/not-a-real-file`);
    assert.equal(response.status, 404);
  });
});

test('application modules and PWA assets are served with usable content types', async () => {
  await withServer(async base => {
    for (const [path, expectedType, marker] of [
      ['/app.js', 'text/javascript', 'renderHome'],
      ['/booking-rules.mjs', 'text/javascript', 'initialBookingStatus'],
      ['/styles.css', 'text/css', '--navy'],
      ['/manifest.webmanifest', 'application/manifest+json', '"lang": "ar-EG"'],
      ['/sw.js', 'text/javascript', 'addEventListener']
    ]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, `${path} should load`);
      assert.ok((response.headers.get('content-type') || '').includes(expectedType), `${path} content type`);
      assert.ok((await response.text()).includes(marker), `${path} should contain expected content`);
    }
  });
});

test('path traversal attempts cannot read files outside the project', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/%2e%2e%2fzaffa-mvp-secret%2f.env`);
    assert.ok([403, 404].includes(response.status), 'outside path must not be readable');
  });
});
