const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_KEY = /^images\/[0-9a-f-]{36}\.jpg$/;
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readJSON(request) {
  const text = await request.text();
  if (text.length > 20000) throw new HttpError(413, '内容过长。');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, '请求格式不正确。');
  }
}

async function signingKey(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new HttpError(503, '发布服务尚未配置。');
  }
  return crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function issueToken(env) {
  const payload = `${Math.floor(Date.now() / 1000) + 12 * 3600}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(env), encoder.encode(payload));
  return `${payload}.${base64url(signature)}`;
}

async function authorize(request, env) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
  const [expires, nonce, signature, extra] = token.split('.');
  if (extra || !/^\d+$/.test(expires || '') || !UUID.test(nonce || '') ||
      !/^[\w-]{43}$/.test(signature || '') || Number(expires) <= Date.now() / 1000) {
    throw new HttpError(401, '登录已过期，请重新登录。');
  }
  const bytes = Uint8Array.from(atob(signature.replaceAll('-', '+').replaceAll('_', '/') + '='),
    (char) => char.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', await signingKey(env), bytes,
    encoder.encode(`${expires}.${nonce}`));
  if (!valid) throw new HttpError(401, '登录已过期，请重新登录。');
}

async function login(request, env) {
  if (!env.PUBLISH_PASSWORD || env.PUBLISH_PASSWORD.length < 16) {
    throw new HttpError(503, '发布服务尚未配置。');
  }
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const windowStart = Math.floor(Date.now() / (15 * 60 * 1000));
  const attempt = await env.DB.prepare(`
    INSERT INTO login_attempts (ip, window_start, attempts) VALUES (?, ?, 1)
    ON CONFLICT(ip) DO UPDATE SET
      attempts = CASE WHEN window_start = excluded.window_start THEN attempts + 1 ELSE 1 END,
      window_start = excluded.window_start
    RETURNING attempts
  `).bind(ip, windowStart).first();
  if (attempt.attempts > 10) throw new HttpError(429, '尝试次数过多，请稍后再登录。');
  const { password } = await readJSON(request);
  const key = await signingKey(env);
  // Compare fixed-size digests with Web Crypto rather than comparing password strings.
  const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(env.PUBLISH_PASSWORD));
  if (typeof password !== 'string' ||
      !await crypto.subtle.verify('HMAC', key, expected, encoder.encode(password))) {
    throw new HttpError(401, '密码不正确。');
  }
  return json({ token: await issueToken(env) });
}

function imageURL(key, request) {
  return `${new URL(request.url).origin}/media/${key}`;
}

function serialize(row, request, env) {
  return { ...row, images: JSON.parse(row.images).map((image) => ({
    ...image, url: imageURL(image.key, request)
  })) };
}

async function listMoments(request, env) {
  const cursor = new URL(request.url).searchParams.get('cursor');
  let query = 'SELECT * FROM moments';
  let values = [];
  if (cursor) {
    try {
      const [date, id] = JSON.parse(atob(cursor));
      if (typeof date !== 'string' || !UUID.test(id) || new Date(date).toISOString() !== date) {
        throw new Error();
      }
      query += ' WHERE (created_at, id) < (?, ?)';
      values = [date, id];
    } catch {
      throw new HttpError(400, '分页参数不正确。');
    }
  }
  const { results } = await env.DB.prepare(`${query} ORDER BY created_at DESC, id DESC LIMIT 21`)
    .bind(...values).all();
  const items = results.slice(0, 20);
  const last = items.at(-1);
  return json({ items: items.map((row) => serialize(row, request, env)),
    next_cursor: results.length > 20 ? btoa(JSON.stringify([last.created_at, last.id])) : null });
}

async function uploadImage(request, env) {
  if (request.headers.get('Content-Type') !== 'image/jpeg') {
    throw new HttpError(415, '请上传压缩后的 JPEG 图片。');
  }
  if (Number(request.headers.get('Content-Length')) > MAX_IMAGE_BYTES) {
    throw new HttpError(413, '图片不能超过 5 MB。');
  }
  const buffer = await request.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, '图片不能超过 5 MB。');
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) {
    throw new HttpError(400, '图片格式不正确。');
  }
  const key = `images/${crypto.randomUUID()}.jpg`;
  await env.IMAGES.put(key, buffer, { httpMetadata: { contentType: 'image/jpeg' } });
  try {
    await env.DB.prepare('INSERT INTO uploads (key, created_at) VALUES (?, ?)')
      .bind(key, new Date().toISOString()).run();
  } catch (error) {
    await env.IMAGES.delete(key);
    throw error;
  }
  return json({ key, url: imageURL(key, request) }, 201);
}

function validateBody(body) {
  if (typeof body !== 'string' || body.length > 5000) {
    throw new HttpError(400, '正文不能超过 5000 字。');
  }
  return body.trim();
}

async function createMoment(request, env) {
  const input = await readJSON(request);
  const body = validateBody(input.body);
  if (!UUID.test(input.id) || !Array.isArray(input.images) || input.images.length > 9 ||
      (!body && !input.images.length)) throw new HttpError(400, '请填写文字或选择图片，最多 9 张。');
  const images = input.images.map((image) => {
    if (!image || typeof image !== 'object') throw new HttpError(400, '图片信息不正确。');
    const { key, width, height } = image;
    if (!IMAGE_KEY.test(key) || !Number.isInteger(width) || !Number.isInteger(height) ||
        width < 1 || height < 1 || width > 1600 || height > 1600) {
      throw new HttpError(400, '图片信息不正确。');
    }
    return { key, width, height };
  });
  if (new Set(images.map((image) => image.key)).size !== images.length) {
    throw new HttpError(400, '图片不能重复。');
  }
  // Re-check this both before validation and after a concurrent write.
  async function findSavedMoment() {
    const saved = await env.DB.prepare('SELECT * FROM moments WHERE id = ?').bind(input.id).first();
    if (!saved) return null;
    if (saved.body !== body || saved.images !== JSON.stringify(images)) {
      throw new HttpError(409, '这条动态已经发布，请刷新后修改。');
    }
    return json(serialize(saved, request, env));
  }
  const existing = await findSavedMoment();
  if (existing) return existing;
  for (const image of images) {
    const upload = await env.DB.prepare('SELECT * FROM uploads WHERE key = ?').bind(image.key).first();
    if (!upload || upload.expired || upload.moment_id || !await env.IMAGES.head(image.key)) {
      const saved = await findSavedMoment();
      if (saved) return saved;
      throw new HttpError(400, '图片已失效，请重新选择。');
    }
  }
  const createdAt = new Date().toISOString();
  // A trigger rejects concurrent claims; D1 batch rolls the whole operation back on failure.
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO moments (id, body, images, created_at) VALUES (?, ?, ?, ?)')
        .bind(input.id, body, JSON.stringify(images), createdAt),
      ...images.map(({ key }) => env.DB.prepare('UPDATE uploads SET moment_id = ? WHERE key = ?')
        .bind(input.id, key))
    ]);
  } catch (error) {
    // Concurrent retries may insert the same ID before this transaction begins.
    const saved = await findSavedMoment();
    if (saved) return saved;
    if (/Image (unavailable|expired|already belongs)/.test(error.message)) {
      throw new HttpError(400, '图片已失效或已被使用，请重新选择。');
    }
    throw error;
  }
  return json(serialize({ id: input.id, body, images: JSON.stringify(images), created_at: createdAt },
    request, env), 201);
}

async function manageMoment(request, env, id) {
  if (!UUID.test(id)) throw new HttpError(404, '没有找到这条动态。');
  const row = await env.DB.prepare('SELECT * FROM moments WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, '没有找到这条动态。');
  if (request.method === 'PATCH') {
    const body = validateBody((await readJSON(request)).body);
    if (!body && JSON.parse(row.images).length === 0) throw new HttpError(400, '动态不能为空。');
    await env.DB.prepare('UPDATE moments SET body = ? WHERE id = ?').bind(body, id).run();
    return json(serialize({ ...row, body }, request, env));
  }
  // Unclaimed images are removed by scheduled cleanup rather than during deletion.
  await env.DB.batch([
    env.DB.prepare('UPDATE uploads SET moment_id = NULL, created_at = ? WHERE moment_id = ?')
      .bind(new Date().toISOString(), id),
    env.DB.prepare('DELETE FROM moments WHERE id = ?').bind(id)
  ]);
  return json({ deleted: true });
}

async function media(request, env, key) {
  if (!IMAGE_KEY.test(key)) throw new HttpError(404, '图片不存在。');
  const published = await env.DB.prepare(`
    SELECT uploads.key FROM uploads
    JOIN moments ON moments.id = uploads.moment_id
    WHERE uploads.key = ? AND uploads.expired = 0
  `).bind(key).first();
  if (!published) throw new HttpError(404, '图片不存在。');
  const object = await env.IMAGES.get(key);
  if (!object) throw new HttpError(404, '图片不存在。');
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', ETag: object.httpEtag }
  });
}

export async function cleanup(env) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const { results } = await env.DB.prepare(
    `UPDATE uploads SET expired = 1 WHERE key IN (
      SELECT key FROM uploads WHERE moment_id IS NULL AND created_at < ? LIMIT 100
    ) AND moment_id IS NULL RETURNING key`
  ).bind(cutoff).all();
  for (const { key } of results) {
    await env.IMAGES.delete(key);
    await env.DB.prepare('DELETE FROM uploads WHERE key = ? AND moment_id IS NULL').bind(key).run();
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE window_start < ?')
    .bind(Math.floor(Date.now() / 900000) - 1).run();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim());
    let response;
    try {
      if (origin && !allowed.includes(origin)) throw new HttpError(403, '不允许从这个网站访问。');
      const { pathname } = new URL(request.url);
      if (request.method === 'OPTIONS') {
        response = new Response(null, { status: 204 });
      } else if (pathname.startsWith('/media/') && ['GET', 'HEAD'].includes(request.method)) {
        response = await media(request, env, pathname.slice('/media/'.length));
      } else if (pathname === '/api/moments' && request.method === 'GET') {
        response = await listMoments(request, env);
      } else if (pathname === '/api/login' && request.method === 'POST') {
        response = await login(request, env);
      } else {
        await authorize(request, env);
        if (pathname === '/api/images' && request.method === 'POST') {
          response = await uploadImage(request, env);
        } else if (pathname === '/api/moments' && request.method === 'POST') {
          response = await createMoment(request, env);
        } else if (pathname.startsWith('/api/moments/') && ['PATCH', 'DELETE'].includes(request.method)) {
          response = await manageMoment(request, env, pathname.slice('/api/moments/'.length));
        } else {
          throw new HttpError(404, '接口不存在。');
        }
      }
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      response = json({ error: error instanceof HttpError ? error.message : '服务暂时不可用，请稍后重试。' },
        error.status || 500);
    }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    if (origin && allowed.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      headers.set('Vary', 'Origin');
    }
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event, env) {
    await cleanup(env);
  }
};
