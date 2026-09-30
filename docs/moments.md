# 图文日常

博客页面继续由 GitHub Pages / Jekyll 托管。动态通过浏览器请求 Cloudflare Worker，正文和图片信息保存到 D1，JPEG 文件保存到 R2。发布不触发博客构建。

## 已实现

- `/moments/`：按时间倒序展示，每页 20 条，图片放大、加载更多、失败重试。
- `/moments/publish/`：密码登录、手机选图预览、发布、修改正文、删除动态。管理区展示最近 20 条。
- 每条最多 9 张照片；上传前通过 Canvas 转为 JPEG，最长边 1600 像素，移除原文件元数据。浏览器不能解码的 HEIC 需要先转换。未保存的草稿只留在当前页面，刷新或关闭页面会丢失。
- 登录会话有效期 12 小时，token 只留在发布页内存中，刷新或离开页面后需要重新登录。每个 IP 每 15 分钟最多尝试登录 10 次。
- 发布 ID 用于幂等重试。保存结果未知时锁定草稿，重试相同请求，避免重复发布。图片上传响应丢失可能产生未引用文件，由清理任务回收。
- 删除动态立即移除公开记录；未引用或删除后释放的图片保留 7 天，每日 UTC 03:00 清理最多 100 张。图片接口仅允许读取已发布动态引用的照片，删除后新请求立即返回 404。响应使用 no-store，避免新缓存；已经下载的副本无法撤回。图片不可在多个动态间复用。

## 本地运行

需要 Node.js 22+，以及能运行本项目的 Ruby / Bundler / Jekyll 环境。

```bash
cd workers/moments
npm ci
cp .dev.vars.example .dev.vars
```

在 `.dev.vars` 设置两个不同的随机值：`PUBLISH_PASSWORD` 至少 16 字符，`SESSION_SECRET` 至少 32 字符。这些文件已被 Git 忽略。

```bash
npm run migrate:local
npm run dev
```

Wrangler 默认在 `http://localhost:8787` 运行，D1 和 R2 使用本地模拟存储，不需要真实 Cloudflare 资源。

在另一个终端，于仓库根目录创建临时覆盖配置：

```bash
printf 'moments_api_url: "http://localhost:8787"\n' > /tmp/blog-moments-local.yml
bundle exec jekyll serve --config _config.yml,/tmp/blog-moments-local.yml
```

打开 `http://localhost:4000/moments/publish/`，使用本地发布密码。先发布文字，再发布含图片的动态，并在 `/moments/` 检查结果。Canvas、UUID 等功能要求安全上下文，localhost 可以使用；手机访问本机 HTTP 局域网地址不属于安全上下文，应使用 HTTPS 预览或部署后验证。

接口回归：

```bash
cd workers/moments
npm test
```

测试使用临时 Miniflare D1/R2，不接触远程数据。

## 首次部署

以下命令在 `workers/moments/` 执行。R2 需要在 Cloudflare 账号中开通，按控制台要求设置付款方式；免费额度不等于硬性费用上限。

```bash
npx wrangler login
npx wrangler d1 create blog-moments
npx wrangler r2 bucket create blog-images
```

把 D1 创建结果中的 `database_id` 写入 `wrangler.jsonc`，替换全零占位值。核对 R2 的 `bucket_name`。

正式部署前，将 `ALLOWED_ORIGINS` 改为实际博客来源，例如 `https://zhaowenhai.com`，移除本地开发地址；如使用 www 域名，明确加入对应来源。

```bash
npx wrangler secret put PUBLISH_PASSWORD
npx wrangler secret put SESSION_SECRET
npm run migrate:remote
npm run deploy
```

两个 secret 分别使用长随机密码和签名密钥，不放进 `vars`、Git、页面或聊天。更换签名密钥会使已有会话失效；只更换发布密码不会撤销已签发 token。

将部署得到的 Worker HTTPS 根地址写入仓库 `_config.yml`：

```yaml
moments_api_url: "https://blog-moments.<你的子域>.workers.dev"
```

正常构建、发布博客后验证手机发布流程。Worker 未配置时页面显示服务尚未配置。

## 图片访问与发布页隔离

R2 存储桶必须保持私有：不要开启 r2.dev 公开访问，不要给存储桶绑定公开自定义域名。已有公开入口需在 Cloudflare 控制台关闭，否则可以绕过 Worker 的发布状态检查。

图片统一通过 Worker 的 `/media/images/...` 读取。接口在每次请求时确认照片仍属于已发布动态；未发布、已删除或已过期的照片均返回 404，即使 R2 文件尚未清理。图片响应使用 `Cache-Control: no-store`。每次读取消耗 Worker 请求和 D1 查询额度，这是实现访问撤销的成本。

如需图片子域名，应将该子域名路由到 Worker，不能直接连接公开 R2 存储桶。当前实现使用 Worker 自身地址，暂不配置独立图片域名。

发布页使用独立 `publisher` 布局，仅加载本站脚本，不加载统计、MathJax 或第三方脚本，并通过 CSP 限制脚本来源。会话 token 仅留在页面内存，避免普通博客页面的第三方脚本读取持久会话。刷新、关闭或离开发布页后需要重新登录。

R2 仅存储文件，不会自动生成缩略图。当前展示使用上传的压缩图片；暂不引入额外图片处理服务。正常页面上传的 Canvas 重编码不会保留原文件 EXIF；直接调用上传 API 不提供服务端 EXIF 清理。

## 数据与备份

数据库通过迁移管理：`moments` 存动态，`uploads` 追踪图片归属和清理状态，`login_attempts` 限制密码猜测。图片在发布事务内检查归属；D1 与 R2 之间没有共同事务。

D1 备份可执行：

```bash
npx wrangler d1 export blog-moments --remote --output /tmp/blog-moments-backup.sql
```

另外通过 R2 的 S3 兼容接口使用 rclone 等工具备份图片。数据库导出不包含图片，不能替代文件备份。备份应留在仓库外；自动定期备份尚未配置。

## 接口

- `POST /api/login`：`{password}` → `{token}`。
- `GET /api/moments?cursor=...`：`{items, next_cursor}`，每条动态含 `id`、`body`、`created_at`、`images`。
- `POST /api/images`：Bearer 会话 + `image/jpeg` 二进制，最多 5 MB → `{key, url}`。
- `POST /api/moments`：Bearer 会话 + `{id, body, images:[{key,width,height}]}`。
- `PATCH /api/moments/:id`：Bearer 会话 + `{body}`，修改文字。
- `DELETE /api/moments/:id`：Bearer 会话，删除动态。
- `GET /media/images/:filename`：默认图片读取入口。

错误返回 `{error}`。公开列表不需要登录，所有写操作需要验证会话；CORS 限制浏览器来源，不能替代认证。
