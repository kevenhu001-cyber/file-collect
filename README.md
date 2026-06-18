# 文件收集 (File Collection Platform)

轻量、高效的文件提交与管理平台。教师、活动组织者或项目负责人可以快速创建收集主题，参与者通过专属链接即可上传文件，所有提交自动归档，管理员可一键打包下载。

## 功能特性

- **多主题并行收集** — 同时创建多个独立的收集任务，每个任务拥有专属提交链接和独立存储空间
- **灵活的窗口管理** — 为每个收集设置截止时间，或手动暂停/恢复，精确控制提交窗口
- **大文件上传** — 单文件最大 500MB，支持拖拽上传
- **管理后台** — 查看所有提交者和文件清单，支持按用户筛选、单个或批量 ZIP 打包下载
- **速率限制** — 内置 IP 级别的上传频率控制，防止滥用
- **登录持久化** — Session 持久化存储，服务器重启或浏览器关闭后无需重新登录

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Node.js 22 + Express 4 |
| 反向代理 | Nginx 1.24 |
| SSL 证书 | Let's Encrypt (Certbot) |
| 前端 | 原生 HTML + CSS + JavaScript（无框架依赖） |
| 文件存储 | 本地文件系统 |
| 进程管理 | PM2 |

## 快速部署

### 前置要求

- Node.js >= 18
- Nginx
- 一个域名（或子域名）解析到服务器 IP

### 1. 克隆项目

```bash
git clone https://github.com/kevenhu001-cyber/file-collect.git
cd file-collect
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动应用

```bash
# 开发模式（文件修改自动重启）
npm run dev

# 生产模式
npm start

# 推荐使用 PM2 管理进程
pm2 start server.js --name file-collect
```

应用默认运行在 `http://localhost:3000`。

### 4. 配置 Nginx

创建一个 Nginx 配置文件 `/etc/nginx/sites-enabled/yourdomain.com`：

```nginx
server {
    server_name yourdomain.com;

    client_max_body_size 500M;

    # 静态介绍页（可选）
    root /path/to/file-collect/landing;
    location = / {
        try_files /index.html =404;
    }

    # 管理后台
    location /admin {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API 接口
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }

    # 收集上传页
    location /collect/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }

    # 静态资源
    location ~ ^/(script\.js|style\.css)$ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 443 ssl http2;
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}
```

### 5. 申请 SSL 证书

```bash
# 安装 Certbot
apt install certbot python3-certbot-nginx

# 申请证书（自动配置 Nginx）
certbot --nginx -d yourdomain.com

# 或使用 webroot 模式
certbot certonly --webroot -w /var/www/html -d yourdomain.com
```

### 6. 启动并验证

```bash
# 测试 Nginx 配置
nginx -t

# 重载 Nginx
systemctl reload nginx

# 确认服务运行
curl https://yourdomain.com/api/collection/status
```

## 使用指南

### 管理后台

访问 `https://yourdomain.com/admin`，默认密码为 `750205`（可在 `server.js` 中修改 `ADMIN_PASSWORD`）。

后台功能：

1. **切换收集** — 顶部下拉菜单切换不同收集任务
2. **收集管理** — 点击"管理收集"创建新的收集主题或删除已有收集
3. **设置** — 配置收集状态（暂停/收集中）、截止时间、IP 速率限制
4. **文件管理** — 查看所有提交者和文件，支持单个删除或全部打包下载

### 上传页面

每个收集有独立的提交链接：
- `https://yourdomain.com/collect/experiment/`
- `https://yourdomain.com/collect/modeling/`

参与者无需注册登录，打开页面填写姓名、选择文件即可上传。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 应用监听端口 |

## 管理员密码

密码硬编码在 `server.js` 第 13 行：

```js
const ADMIN_PASSWORD = '750205';
```

如需修改密码，编辑该行后重启应用：

```bash
pm2 restart file-collect
```

## 文件结构

```
file-collect/
├── admin/
│   └── index.html        # 管理后台页面
├── config/
│   ├── settings.json     # 收集配置持久化
│   └── sessions.json     # 登录 session（自动生成）
├── logs/                 # PM2 日志
├── public/
│   ├── index.html        # 文件上传页面
│   ├── script.js         # 上传页面脚本
│   ├── style.css         # 全局样式
│   └── modeling/         # 建模收集上传页
├── uploads/              # 上传文件存储目录
├── server.js             # 应用主文件
├── package.json
├── ecosystem.config.cjs  # PM2 配置文件
└── .gitignore
```

## 开发

```bash
# 开发模式（热重载）
npm run dev
```

## License

MIT
