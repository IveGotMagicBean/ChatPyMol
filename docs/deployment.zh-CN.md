# ChatPyMOL 生产部署与安全清单

## 先给结论

当前 `0.2.0` 可以部署到一台服务器做个人使用、实验室内测或带额外访问控制的邀请制测试。暂不建议直接把它作为“任何陌生访客都能使用百炼额度”的公开服务。

浏览器负责 PyMOL-WASM 渲染，服务器主要承担结构文件、消息、版本、导出和模型 API 调用。上线时磁盘、备份和模型额度保护通常比 GPU 更重要；服务端本身不要求 GPU。

## 当前必须了解的边界

- 匿名设备令牌是 bearer 凭据，没有账号找回和强身份认证；
- 当前没有完整的设备、Session、版本、磁盘和模型消费配额；
- `DATA_DIR` 是单进程文件存储，不能由多个 Node.js 副本并发写入；
- 实时事件连接当前把设备令牌放在查询参数中，反向代理或 CDN 访问日志可能记录它；
- 服务器上的百炼/OpenAI Key 对所有获准使用 AI 的访客共享。

公开测试前，至少应完成短期 SSE ticket/安全 cookie、IP 与设备双层限流、磁盘/版本/模型额度、数据清理策略和邀请制入口。

## 受控内测部署

### 1. 准备代码

```bash
git clone git@github.com:IveGotMagicBean/ChatPyMol.git
cd ChatPyMol
npm ci --ignore-scripts
npm run build
cp .env.example .env
chmod 600 .env
```

编辑 `.env`：

```dotenv
HOST=127.0.0.1
PORT=8787
DATA_DIR=/srv/chatpymol/data
CHATPYMOL_PUBLIC_URL=https://chatpymol.example.com

DASHSCOPE_API_KEY=
BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
BAILIAN_MODEL=qwen3.7-max
```

生产环境只让 Node 监听回环地址，由 Nginx/Caddy 提供 HTTPS。`DATA_DIR` 应放在持久磁盘，且只允许服务用户读写。

### 2. 运行单进程服务

可以使用 systemd、PM2 或容器运行：

```bash
NODE_ENV=production npm start
```

健康检查：

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

不要同时启动两个共享同一 `DATA_DIR` 的实例。需要多副本时，应先把存储与锁迁移到支持并发的数据库/对象存储。

### 3. Nginx 关键配置

以下只展示 ChatPyMOL 相关关键项；证书、域名和系统安全策略应按实际环境配置。

```nginx
server {
    listen 443 ssl http2;
    server_name chatpymol.example.com;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }

    # 当前版本的 SSE URL 含匿名设备令牌，至少禁止写入访问日志。
    location = /api/events {
        access_log off;
        proxy_buffering off;
        proxy_cache off;
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
```

关闭这一路日志只是临时缓解，不替代短期 SSE ticket 或 HttpOnly/SameSite/Secure 会话 cookie。

## 上线前检查

- [ ] 域名强制 HTTPS，HTTP 自动跳转；
- [ ] 8787 端口不对公网开放；
- [ ] `.env` 权限为 `0600`，密钥不在 Git、日志或进程参数中；
- [ ] `/api/events` 不记录查询参数；
- [ ] 站点处于 VPN、Basic Auth、SSO、邀请码或其他访问控制之后；
- [ ] 对 bootstrap、chat、upload、MCP、pair 和 export 设置限流；
- [ ] 设置单文件、单设备总存储、Session 数、版本数和模型消费上限；
- [ ] 对 `DATA_DIR` 做加密备份并实际演练恢复；
- [ ] 配置磁盘、5xx、模型错误率和费用告警；
- [ ] 明确数据保存时长与删除流程；
- [ ] 使用独立低权限系统用户运行服务；
- [ ] 执行 `npm test`、`npm run build` 和生产依赖漏洞审计；
- [ ] 在 Chrome/Firefox 中完成上传、原生编辑、AI 修改、历史回看、PSE/PNG 导出与断线重连验收。

## 迁移服务器

1. 停止旧服务，避免复制过程中继续写入；
2. 备份代码版本、`.env`（单独安全传输）和整个 `DATA_DIR`；
3. 在新服务器安装相同 Node.js 大版本并执行 `npm ci --ignore-scripts && npm run build`；
4. 恢复数据目录并设置正确所有者与权限；
5. 启动单个服务实例，检查健康接口；
6. 使用已有浏览器设备令牌验证旧 Session、结构和版本仍可访问；
7. 验证后再切换域名。

密钥、设备令牌和未公开科研数据不应进入普通 GitHub Release、公共对象存储或公开录屏。
