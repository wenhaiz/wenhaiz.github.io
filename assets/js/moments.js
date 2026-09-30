(() => {
  'use strict';
  const root = document.querySelector('[data-moments]');
  if (!root) return;
  const base = root.dataset.api.replace(/\/$/, '');
  const status = document.getElementById('moments-status');
  const say = (message) => {
    status.textContent = message;
  };
  if (!base) {
    say('日常服务尚未配置，请稍后再来。');
    root.querySelectorAll('form').forEach((form) => {
      form.hidden = true;
    });
    return;
  }
  // Keep the publishing session off other pages that share this origin.
  let token = '';
  let onUnauthorized = () => {};
  async function request(path, options = {}) {
    const headers = new Headers(options.headers);
    const requestToken = token;
    if (options.auth) headers.set('Authorization', `Bearer ${requestToken}`);
    const response = await fetch(`${base}${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && options.auth && token === requestToken) {
      token = '';
      onUnauthorized();
    }
    if (!response.ok) {
      const error = new Error(data.error || `请求失败（${response.status}），请重试。`);
      error.httpStatus = response.status;
      throw error;
    }
    return data;
  }
  const json = (method, value) => ({
    method,
    auth: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  function safeImageUrl(value) {
    try {
      const url = new URL(value);
      return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }
  function renderMoment(item, container) {
    const article = document.createElement('article');
    article.className = 'moment';
    const time = document.createElement('time');
    time.dateTime = item.created_at;
    time.textContent = new Date(item.created_at).toLocaleString('zh-CN', { hour12: false });
    const body = document.createElement('p');
    body.className = 'moment-body';
    body.textContent = item.body;
    article.append(time, body);
    const images = item.images || [];
    const grid = document.createElement('div');
    grid.className = `moments-grid${images.length === 1 ? ' single' : ''}`;
    images.forEach((photo, index) => {
      const url = safeImageUrl(photo.url);
      if (!url) return;
      const image = document.createElement('img');
      image.src = url;
      image.alt = `动态照片 ${index + 1}`;
      image.loading = 'lazy';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'moments-photo-button';
      button.setAttribute('aria-label', `放大照片 ${index + 1}`);
      button.append(image);
      button.addEventListener('click', () => {
        const dialog = document.getElementById('moments-photo');
        dialog.querySelector('img').src = url;
        dialog.showModal();
      });
      grid.append(button);
    });
    article.append(grid);
    container.append(article);
    return { article, body };
  }
  if (root.dataset.moments === 'list') {
    const list = document.getElementById('moments-list');
    const more = document.getElementById('moments-more');
    const dialog = document.getElementById('moments-photo');
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
    let cursor = '';
    let busy = false;
    const seen = new Set();
    async function load() {
      if (busy) return;
      busy = true;
      more.disabled = true;
      say('正在加载……');
      try {
        const data = await request(`/api/moments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
        data.items.forEach((item) => {
          if (!seen.has(item.id)) {
            renderMoment(item, list);
            seen.add(item.id);
          } });
        cursor = data.next_cursor || '';
        more.hidden = !cursor;
        more.textContent = '加载更多';
        say(seen.size ? '' : '还没有日常记录。');
      } catch (error) {
        say(error.message);
        more.hidden = false;
        more.textContent = '重试';
      }
      finally {
        busy = false;
        more.disabled = false;
      }
    }
    more.addEventListener('click', load);
    load();
    return;
  }
  const login = document.getElementById('moments-login');
  const publish = document.getElementById('moments-publish');
  const bodyInput = document.getElementById('moments-body');
  const filesInput = document.getElementById('moments-files');
  const previews = document.getElementById('moments-previews');
  const management = document.getElementById('moments-manage');
  let photos = [];
  let pendingId = crypto.randomUUID();
  let pendingPayload = null;
  let busy = false;
  let sessionVersion = 0;
  let managementVersion = 0;

  function updateControls() {
    root.querySelectorAll('input, textarea, button').forEach((control) => {
      control.disabled = busy;
    });
    if (pendingPayload) {
      bodyInput.disabled = true;
      filesInput.disabled = true;
      previews.querySelectorAll('button').forEach((button) => {
        button.disabled = true;
      });
    }
    management.querySelectorAll('button').forEach((button) => {
      button.disabled = busy || !!pendingPayload;
    });
    document.getElementById('moments-submit').textContent = pendingPayload ? '重试发布' : '发布';
  }
  function lock(value) {
    busy = value;
    updateControls();
  }
  function showSession() {
    login.hidden = !!token;
    publish.hidden = !token;
    management.hidden = !token;
    if (!token) management.replaceChildren();
  }
  onUnauthorized = () => {
    sessionVersion += 1;
    showSession();
  };
  showSession();
  login.addEventListener('submit', async (event) => {
    event.preventDefault();
    lock(true);
    say('正在登录……');
    try {
      const result = await request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('moments-password').value }),
      });
      sessionVersion += 1;
      token = result.token;
      login.reset();
      showSession();
      say('已登录。');
      loadManagement();
    } catch (error) {
      say(error.message);
    } finally {
      lock(false);
    }
  });
  document.getElementById('moments-logout').addEventListener('click', () => {
    sessionVersion += 1;
    token = '';
    showSession();
    document.getElementById('moments-manage').replaceChildren();
    say('已退出登录。');
  });
  async function compress(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
      } catch {
        throw new Error(`无法读取「${file.name}」，请将 HEIC 等格式转换成 JPEG 后再选择。`);
      }
      const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .82));
      if (!blob || blob.size > 5 * 1024 * 1024) throw new Error('图片压缩后仍超过 5 MB，请缩小图片后重试。');
      return { blob, width: canvas.width, height: canvas.height, preview: URL.createObjectURL(blob), uploaded: null };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  function renderPreviews() {
    previews.replaceChildren();
    photos.forEach((photo, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'moments-preview';
      const image = document.createElement('img');
      image.src = photo.preview;
      image.alt = `待发布照片 ${index + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '移除';
      remove.disabled = busy || !!pendingPayload;
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(photo.preview);
        photos.splice(index, 1);
        renderPreviews();
      });
      wrapper.append(image, remove);
      previews.append(wrapper);
    });
  }
  filesInput.addEventListener('change', async () => {
    const files = Array.from(filesInput.files);
    filesInput.value = '';
    if (photos.length + files.length > 9) {
      say('每条动态最多选择 9 张照片。');
      return;
    }
    lock(true);
    say('正在处理照片……');
    try {
      for (const file of files) photos.push(await compress(file));
      say('照片已准备好。');
    } catch (error) {
      say(error.message);
    } finally {
      lock(false);
      renderPreviews();
    }
  });
  publish.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const body = bodyInput.value.trim();
    if (!body && !photos.length) {
      say('请写点文字或选择照片。');
      return;
    }
    if (body.length > 5000) {
      say('文字最多 5000 字。');
      return;
    }
    lock(true);
    try {
      for (let index = 0; index < photos.length; index += 1) {
        const photo = photos[index];
        if (photo.uploaded) continue;
        say(`正在上传照片 ${index + 1}/${photos.length}……`);
        photo.uploaded = await request('/api/images', {
          method: 'POST',
          auth: true,
          headers: { 'Content-Type': 'image/jpeg' },
          body: photo.blob,
        });
      }
      if (!pendingPayload) {
        pendingPayload = {
          id: pendingId,
          body,
          images: photos.map((photo) => ({
            key: photo.uploaded.key,
            width: photo.width,
            height: photo.height,
          })),
        };
      }
      say('正在保存动态……');
      await request('/api/moments', json('POST', pendingPayload));
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      photos = [];
      pendingId = crypto.randomUUID();
      pendingPayload = null;
      bodyInput.value = '';
      renderPreviews();
      say('发布成功。');
      loadManagement();
    } catch (error) {
      // 明确的校验错误允许修改草稿；网络或服务端失败时保留原请求。
      if (error.httpStatus >= 400 && error.httpStatus < 500 && ![401, 409].includes(error.httpStatus)) {
        pendingPayload = null;
      }
      const help = pendingPayload
        ? '发布结果尚未确认，草稿已锁定，请重新登录或重试发布以确认结果。'
        : '输入和已上传的照片已保留，可以重试。';
      say(`${error.message} ${help}`);
    } finally {
      lock(false);
    }
  });
  async function loadManagement() {
    const container = management;
    if (!token) return;
    const expectedSession = sessionVersion;
    const expectedLoad = ++managementVersion;
    try {
      const data = await request('/api/moments');
      if (!token || sessionVersion !== expectedSession || managementVersion !== expectedLoad) return;
      container.replaceChildren();
      for (const item of data.items) {
        const article = document.createElement('article');
        article.className = 'moment';
        const text = document.createElement('p');
        text.className = 'moment-body';
        text.textContent = item.body || '（仅图片）';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = '修改文字';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'moments-secondary';
        remove.textContent = '删除';
        edit.addEventListener('click', async () => {
          const next = window.prompt('修改动态文字（最多 5000 字）', item.body);
          if (next === null) return;
          if (next.length > 5000 || (!next.trim() && !item.images.length)) {
            say('请保留文字或图片，文字最多 5000 字。');
            return;
          }
          lock(true);
          try {
            await request(`/api/moments/${encodeURIComponent(item.id)}`, json('PATCH', { body: next.trim() }));
            item.body = next.trim();
            text.textContent = item.body || '（仅图片）';
            say('已保存修改。');
          } catch (error) {
            say(error.message);
          } finally {
            lock(false);
          }
        });
        remove.addEventListener('click', async () => {
          if (!window.confirm('确定删除这条动态？照片会在稍后清理。')) return;
          lock(true);
          try {
            await request(`/api/moments/${encodeURIComponent(item.id)}`, { method: 'DELETE', auth: true });
            article.remove();
            say('已删除。');
          } catch (error) {
            say(error.message);
          } finally {
            lock(false);
          }
        });
        article.append(text, edit, remove);
        container.append(article);
      }
      updateControls();
    } catch (error) {
      if (token && sessionVersion === expectedSession && managementVersion === expectedLoad) {
        say(`管理列表加载失败：${error.message}`);
      }
    }
  }
  if (token) loadManagement();
})();
