import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanup } from '../src/index.js';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const origin = 'https://zhaowenhai.com';
const password = 'test-password-not-for-deployment';
let runtime;
let token;
let database;

async function request(path, { method = 'GET', body, auth = false, headers = {} } = {}) {
  return runtime.dispatchFetch(`https://moments.test${path}`, {
    method,
    headers: { Origin: origin, ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : body
  });
}
function jsonOptions(body, method = 'POST') {
  return { method, body: JSON.stringify(body), auth: true, headers: { 'Content-Type': 'application/json' } };
}
async function photo() {
  const response = await request('/api/images', {
    method: 'POST', auth: true, body: new Uint8Array([255, 216, 255, 224, 0, 0, 255, 217]),
    headers: { 'Content-Type': 'image/jpeg' }
  });
  assert.equal(response.status, 201);
  return { ...(await response.json()), width: 100, height: 100 };
}

before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({
    name: 'moments', modules: true, scriptPath: new URL('../src/index.js', import.meta.url).pathname,
    compatibilityDate: '2026-09-30',
    bindings: { ALLOWED_ORIGINS: origin, PUBLISH_PASSWORD: password,
      SESSION_SECRET: 'test-secret-with-at-least-32-characters',
      IMAGE_BASE_URL: 'https://public-bucket.test' },
    d1Databases: { DB: 'test-db' }, r2Buckets: ['IMAGES']
  }));
  database = await runtime.getD1Database('DB');
  const migration = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  // D1 exec is line-oriented; prepare whole SQL statements, including trigger bodies.
  const statements = migration.split(/;\s*\n/);
  let trigger = '';
  for (let statement of statements) {
    statement = statement.trim();
    if (!statement) continue;
    if (trigger) { trigger += `;\n${statement}`; }
    else if (statement.includes('CREATE TRIGGER')) { trigger = statement; }
    else { await database.prepare(statement).run(); }
    if (trigger && /END$/.test(trigger)) { await database.prepare(trigger).run(); trigger = ''; }
  }
  const response = await request('/api/login', jsonOptions({ password }));
  assert.equal(response.status, 200);
  token = (await response.json()).token;
});
after(async () => { await runtime?.dispose(); });

test('rejects unauthorized writes, invalid signatures and cross-origin requests', async () => {
  assert.equal((await request('/api/images', { method: 'POST' })).status, 401);
  assert.equal((await request('/api/moments', { headers: { Origin: 'https://other.test' } })).status, 403);
  assert.equal((await request('/api/images', {
    method: 'POST', headers: { Authorization: `Bearer ${token.slice(0, -5)}abcde` }
  })).status, 401);
  const preflight = await request('/api/moments', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
});

test('upload, publish, retry, read image, edit and delete using real D1/R2 bindings', async () => {
  const image = await photo();
  assert.equal((await request(`/media/${image.key}`)).status, 404);
  assert.equal((await request(`/media/${image.key}`, { method: 'HEAD' })).status, 404);
  const payload = { id: crypto.randomUUID(), body: '测试图文 <script>', images: [image] };
  const response = await request('/api/moments', jsonOptions(payload));
  assert.equal(response.status, 201);
  const retry = await request('/api/moments', jsonOptions(payload));
  assert.equal(retry.status, 200);
  const list = await (await request('/api/moments')).json();
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].body, payload.body);
  assert.equal(list.items[0].images[0].url, `https://moments.test/media/${image.key}`);
  const media = await request(`/media/${image.key}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(media.headers.get('Cache-Control'), 'no-store');
  const head = await request(`/media/${image.key}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await request('/api/moments', jsonOptions({ ...payload, body: 'changed' }))).status, 409);
  assert.equal((await request('/api/moments', jsonOptions({ ...payload, id: crypto.randomUUID() }))).status, 400);
  const updated = await request(`/api/moments/${payload.id}`, jsonOptions({ body: '修改后' }, 'PATCH'));
  assert.equal((await updated.json()).body, '修改后');
  assert.equal((await request(`/api/moments/${payload.id}`, { method: 'DELETE', auth: true })).status, 200);
  assert.equal((await (await request('/api/moments')).json()).items.length, 0);
  const upload = await database.prepare('SELECT * FROM uploads WHERE key = ?').bind(image.key).first();
  assert.equal(upload.moment_id, null);
  assert.ok(await (await runtime.getR2Bucket('IMAGES')).head(image.key));
  for (const method of ['GET', 'HEAD']) {
    const deleted = await request(`/media/${image.key}`, { method });
    assert.equal(deleted.status, 404);
    assert.equal(deleted.headers.get('Cache-Control'), 'no-store');
  }
});

test('paginates correctly when timestamps are equal, and rejects malformed cursors', async () => {
  const date = '2026-09-30T00:00:00.000Z';
  await database.batch(Array.from({ length: 22 }, () => database.prepare(
    'INSERT INTO moments (id, body, created_at) VALUES (?, ?, ?)'
  ).bind(crypto.randomUUID(), 'pagination', date)));
  const first = await (await request('/api/moments')).json();
  const second = await (await request(`/api/moments?cursor=${encodeURIComponent(first.next_cursor)}`)).json();
  assert.equal(first.items.length, 20);
  assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 22);
  assert.equal((await request('/api/moments?cursor=bad')).status, 400);
  await database.prepare('DELETE FROM moments').run();
});

test('validates image type, missing uploads and body limits', async () => {
  assert.equal((await request('/api/images', {
    method: 'POST', auth: true, body: 'not an image', headers: { 'Content-Type': 'image/jpeg' }
  })).status, 400);
  assert.equal((await request('/api/images', {
    method: 'POST', auth: true, body: '<svg>', headers: { 'Content-Type': 'image/svg+xml' }
  })).status, 415);
  for (const payload of [
    { id: crypto.randomUUID(), body: 'a'.repeat(5001), images: [] },
    { id: crypto.randomUUID(), body: '', images: [] },
    { id: crypto.randomUUID(), body: 'text', images: [{ key: `images/${crypto.randomUUID()}.jpg`, width: 10, height: 10 }] }
  ]) assert.equal((await request('/api/moments', jsonOptions(payload))).status, 400);
});

test('limits password guesses per IP', async () => {
  for (let index = 0; index < 10; index++) {
    assert.equal((await request('/api/login', {
      ...jsonOptions({ password: 'wrong' }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' }
    })).status, 401);
  }
  assert.equal((await request('/api/login', {
    ...jsonOptions({ password }), headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' }
  })).status, 429);
});

test('transaction rejects an upload removed between validation and publication', async () => {
  const image = await photo();
  await database.prepare('DELETE FROM uploads WHERE key = ?').bind(image.key).run();
  const id = crypto.randomUUID();
  await assert.rejects(database.batch([
    database.prepare('INSERT INTO moments (id, body, images, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, 'race', JSON.stringify([{ key: image.key, width: 100, height: 100 }]), new Date().toISOString()),
    database.prepare('UPDATE uploads SET moment_id = ? WHERE key = ?').bind(id, image.key)
  ]), /Image unavailable/);
  assert.equal(await database.prepare('SELECT id FROM moments WHERE id = ?').bind(id).first(), null);
});

test('expired uploads cannot be claimed even if the file still exists', async () => {
  const image = await photo();
  await database.prepare('UPDATE uploads SET expired = 1 WHERE key = ?').bind(image.key).run();
  const payload = { id: crypto.randomUUID(), body: 'expired', images: [image] };
  assert.equal((await request('/api/moments', jsonOptions(payload))).status, 400);
});

test('cleanup removes old unclaimed files and preserves published images', async () => {
  const abandoned = await photo();
  const published = await photo();
  const payload = { id: crypto.randomUUID(), body: 'keep', images: [published] };
  assert.equal((await request('/api/moments', jsonOptions(payload))).status, 201);
  await database.prepare('UPDATE uploads SET created_at = ? WHERE key IN (?, ?)')
    .bind('2020-01-01T00:00:00.000Z', abandoned.key, published.key).run();
  await cleanup({ DB: database, IMAGES: await runtime.getR2Bucket('IMAGES') });
  assert.equal((await request(`/media/${abandoned.key}`)).status, 404);
  assert.equal((await request(`/media/${published.key}`)).status, 200);
  assert.equal(await database.prepare('SELECT key FROM uploads WHERE key = ?').bind(abandoned.key).first(), null);
});

test('concurrent publication retries create one record', async () => {
  const image = await photo();
  const payload = { id: crypto.randomUUID(), body: 'concurrent', images: [image] };
  const responses = await Promise.all([
    request('/api/moments', jsonOptions(payload)), request('/api/moments', jsonOptions(payload))
  ]);
  assert.ok(responses.every((response) => [200, 201].includes(response.status)));
  const row = await database.prepare('SELECT COUNT(*) AS count FROM moments WHERE id = ?').bind(payload.id).first();
  assert.equal(row.count, 1);
});
