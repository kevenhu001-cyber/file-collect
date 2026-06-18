const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CONFIG_DIR = path.join(__dirname, 'config');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '750205';

// --- Persisted settings ---
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {
      collections: {},
      rateLimit: { enabled: true, maxPerHour: 10 },
    };
  }
}

function saveSettings(settings) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

let settings = loadSettings();

// Seed default collections only on truly first run (no settings file yet)
if (!fs.existsSync(SETTINGS_PATH)) {
  const DEFAULT_COLLECTIONS = {
    experiment: { title: '储能未来 2501', subtitle: '数学实验作业收集', paused: false, deadline: null },
    modeling: { title: '储能未来 2501', subtitle: '数学建模大作业收集', paused: false, deadline: null },
  };

  Object.entries(DEFAULT_COLLECTIONS).forEach(([slug, meta]) => {
    if (!settings.collections[slug]) {
      settings.collections[slug] = { ...meta };
    }
  });
  saveSettings(settings);
}

function getCollectionList() {
  return Object.entries(settings.collections).map(([slug, meta]) => ({
    slug,
    title: meta.title || '',
    subtitle: meta.subtitle || '',
    paused: !!meta.paused,
    deadline: meta.deadline || null,
  }));
}

function getCollectionMeta(slug) {
  const meta = settings.collections[slug];
  if (!meta) return null;
  return {
    slug,
    title: meta.title || '',
    subtitle: meta.subtitle || '',
    paused: !!meta.paused,
    deadline: meta.deadline || null,
  };
}

// --- Rate limiting (in-memory) ---
const rateLimitStore = new Map();

function pruneRateLimit() {
  const now = Date.now();
  const window = 60 * 60 * 1000;
  for (const [ip, timestamps] of rateLimitStore.entries()) {
    const valid = timestamps.filter((t) => now - t < window);
    if (valid.length === 0) rateLimitStore.delete(ip);
    else rateLimitStore.set(ip, valid);
  }
}
setInterval(pruneRateLimit, 5 * 60 * 1000);

function checkRateLimit(ip) {
  const rl = settings.rateLimit;
  if (!rl.enabled) return true;

  const now = Date.now();
  const window = 60 * 60 * 1000;
  let timestamps = rateLimitStore.get(ip) || [];
  timestamps = timestamps.filter((t) => now - t < window);

  if (timestamps.length >= rl.maxPerHour) {
    return false;
  }

  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  return true;
}

// --- Persistent session tokens (survives server restart) ---
const SESSIONS_PATH = path.join(CONFIG_DIR, 'sessions.json');

function loadSessions() {
  try {
    return new Set(JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8')));
  } catch {
    return new Set();
  }
}

function saveSessions() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify([...sessions], null, 2));
}

// Prune excess sessions to cap memory
function pruneSessions() {
  // Sessions have no expiry by default — prune by count: keep latest 200
  if (sessions.size > 200) {
    const arr = [...sessions];
    const keep = arr.slice(arr.length - 200);
    sessions.clear();
    keep.forEach(s => sessions.add(s));
    saveSessions();
  }
}

let sessions = loadSessions();
setInterval(pruneSessions, 24 * 60 * 60 * 1000); // prune once daily

// --- Ensure upload dirs exist ---
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
Object.keys(settings.collections).forEach((slug) => {
  const dir = path.join(UPLOADS_DIR, slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- Multer Configuration ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const collection = req.body.collection || 'experiment';
    const username = req.body.username?.trim() || 'anonymous';
    const userDir = path.join(UPLOADS_DIR, sanitize(collection), sanitize(username));
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = Buffer.from(file.originalname, 'binary').toString('utf8');
    cb(null, `${timestamp}-${originalName}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// --- Helpers ---
function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_').slice(0, 100);
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_.\-() \u4e00-\u9fff]/g, '_').slice(0, 200);
}

function decodeFilename(name) {
  return Buffer.from(name, 'binary').toString('utf8');
}

function collectionDir(collection) {
  return path.join(UPLOADS_DIR, sanitize(collection || 'experiment'));
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection?.remoteAddress || 'unknown';
}

function checkCollectionOpen(collection) {
  const collSettings = settings.collections[collection];
  if (!collSettings) return { open: true };

  if (collSettings.paused) {
    return { open: false, reason: 'paused', message: '该收集已暂停，请等待管理员重新开启。' };
  }

  if (collSettings.deadline) {
    const deadline = new Date(collSettings.deadline);
    if (Date.now() > deadline.getTime()) {
      return { open: false, reason: 'deadline', message: '该收集已截止，感谢您的参与。' };
    }
  }

  return { open: true };
}

// --- Upload page template ---
function renderUploadPage(collection) {
  const meta = getCollectionMeta(collection);
  if (!meta) return null;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>文件收集 - addtech.site</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>文件收集</h1>
      <p>${escHtml(meta.subtitle)}</p>
    </header>

    <main>
      <form id="uploadForm" class="upload-form">
        <input type="hidden" name="collection" value="${escHtml(meta.slug)}" />
        <div class="form-group">
          <label for="username">您的姓名 *</label>
          <input
            type="text"
            id="username"
            name="username"
            required
            placeholder="请输入您的姓名"
            autocomplete="name"
          />
        </div>

        <div class="form-group">
          <label for="file">选择文件 *</label>
          <div class="file-input-wrapper">
            <input type="file" id="file" name="file" required />
            <span class="file-hint" id="fileHint">点击选择文件，或拖拽文件到此处</span>
          </div>
        </div>

        <button type="submit" id="submitBtn" class="submit-btn">
          <span class="btn-text">提交上传</span>
          <span class="btn-loading hidden">上传中...</span>
        </button>
      </form>

      <div id="message" class="message hidden"></div>

      <div id="preview" class="preview hidden">
        <div class="preview-header">已选文件</div>
        <div class="preview-body">
          <span id="previewName"></span>
          <span id="previewSize"></span>
        </div>
      </div>
    </main>

    <footer class="footer">
      <p>&copy; 2026 addtech.site - 文件收集系统</p>
    </footer>
  </div>

  <script src="/script.js"></script>
</body>
</html>`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Auth ---
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  const token = (auth && auth.startsWith('Bearer ') ? auth.slice(7) : null) || req.query.token;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: '请先登录' });
  }
  next();
}

// --- Body parsers ---
app.use(express.json());

// --- Serve static files ---
app.use('/', express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin'), {
  setHeaders: function(res) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));

// --- Dynamic collection upload page ---
app.get('/collect/:slug', (req, res) => {
  const html = renderUploadPage(req.params.slug);
  if (!html) {
    return res.status(404).send('收集不存在');
  }
  res.send(html);
});

// --- Admin auth ---
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.add(token);
    saveSessions();
    return res.json({ success: true, token });
  }
  res.status(401).json({ error: '密码错误' });
});

app.get('/api/admin/check', requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

// --- Admin: list collections ---
app.get('/api/admin/collections', requireAdmin, (_req, res) => {
  res.json({ collections: getCollectionList() });
});

// --- Admin: create collection ---
app.post('/api/admin/collections', requireAdmin, (req, res) => {
  let { slug, title, subtitle } = req.body;

  if (!slug || !title) {
    return res.status(400).json({ error: 'slug 和 title 不能为空' });
  }

  slug = sanitize(slug).toLowerCase();
  if (!slug) {
    return res.status(400).json({ error: 'slug 不合法' });
  }

  if (settings.collections[slug]) {
    return res.status(409).json({ error: '该 slug 已存在' });
  }

  settings.collections[slug] = {
    title: String(title),
    subtitle: String(subtitle || ''),
    paused: false,
    deadline: null,
  };

  // Create upload directory
  const dir = path.join(UPLOADS_DIR, slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  saveSettings(settings);
  res.json({ success: true, collection: getCollectionMeta(slug) });
});

// --- Admin: delete collection ---
app.delete('/api/admin/collections/:slug', requireAdmin, (req, res) => {
  const slug = sanitize(req.params.slug);

  if (!settings.collections[slug]) {
    return res.status(404).json({ error: '收集不存在' });
  }

  // Prevent deleting core collections that have files
  const collectionDirPath = path.join(UPLOADS_DIR, slug);
  let hasFiles = false;
  if (fs.existsSync(collectionDirPath)) {
    const entries = fs.readdirSync(collectionDirPath);
    hasFiles = entries.some((entry) => {
      const entryPath = path.join(collectionDirPath, entry);
      return fs.statSync(entryPath).isDirectory();
    });
  }

  if (hasFiles) {
    return res.status(400).json({ error: '该收集下已有文件，无法删除。请先删除所有用户和文件。' });
  }

  delete settings.collections[slug];
  saveSettings(settings);

  // Remove directory if empty
  if (fs.existsSync(collectionDirPath)) {
    fs.rmSync(collectionDirPath, { recursive: true, force: true });
  }

  res.json({ success: true, message: '收集已删除' });
});

// --- Public collection status (used by upload pages) ---
app.get('/api/collection/status', (req, res) => {
  const coll = req.query.collection || 'experiment';
  const status = checkCollectionOpen(coll);
  const collSettings = settings.collections[coll] || {};
  res.json({
    slug: coll,
    open: status.open,
    reason: status.reason || null,
    message: status.message || null,
    deadline: collSettings.deadline || null,
  });
});

// --- Admin settings ---
app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  const collSettings = {};
  Object.entries(settings.collections).forEach(([slug, meta]) => {
    collSettings[slug] = {
      paused: !!meta.paused,
      deadline: meta.deadline || null,
    };
  });
  res.json({
    collections: collSettings,
    rateLimit: settings.rateLimit,
  });
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const { collection, paused, deadline } = req.body;

  if (collection) {
    if (!settings.collections[collection]) {
      settings.collections[collection] = { title: '', subtitle: '' };
    }
    if (typeof paused === 'boolean') settings.collections[collection].paused = paused;
    if (deadline !== undefined) settings.collections[collection].deadline = deadline || null;
  }

  if (req.body.rateLimit) {
    const rl = req.body.rateLimit;
    if (typeof rl.enabled === 'boolean') settings.rateLimit.enabled = rl.enabled;
    if (typeof rl.maxPerHour === 'number') settings.rateLimit.maxPerHour = Math.max(1, Math.min(100, rl.maxPerHour));
  }

  saveSettings(settings);
  res.json({ success: true, settings });
});

// --- Upload endpoint (public) ---
app.post('/api/upload', (req, res, next) => {
  const coll = req.body.collection || 'experiment';

  // Check if collection exists
  if (!settings.collections[coll]) {
    return res.status(404).json({ error: '收集不存在' });
  }

  // Check if collection is open
  const status = checkCollectionOpen(coll);
  if (!status.open) {
    return res.status(403).json({ error: status.message });
  }

  // Rate limit check
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    const max = settings.rateLimit.maxPerHour;
    return res.status(429).json({ error: `每个 IP 每小时最多上传 ${max} 次，请稍后再试。` });
  }

  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: '文件大小不能超过 500MB' });
        }
        return res.status(400).json({ error: `上传错误: ${err.message}` });
      }
      return res.status(500).json({ error: '服务器内部错误' });
    }

    if (!req.file) {
      return res.status(400).json({ error: '请选择一个文件' });
    }

    const username = req.body.username?.trim() || 'anonymous';
    const decodedFilename = decodeFilename(req.file.originalname);

    res.json({
      success: true,
      message: `上传成功！${username} 的文件已收录。`,
      data: {
        username,
        filename: decodedFilename,
        savedAs: req.file.filename,
        size: req.file.size,
      },
    });
  });
});

// --- List users (admin) ---
app.get('/api/users', requireAdmin, (req, res) => {
  const coll = req.query.collection || 'experiment';
  const baseDir = collectionDir(coll);

  try {
    if (!fs.existsSync(baseDir)) return res.json({ users: [] });

    const users = fs.readdirSync(baseDir).filter((entry) =>
      fs.statSync(path.join(baseDir, entry)).isDirectory()
    );

    const result = users.map((username) => {
      const userDir = path.join(baseDir, username);
      const files = fs.readdirSync(userDir).filter((f) => fs.statSync(path.join(userDir, f)).isFile());
      const totalSize = files.reduce((sum, f) => sum + (fs.statSync(path.join(userDir, f)).size || 0), 0);
      return {
        username,
        fileCount: files.length,
        totalSize,
        files: files.map((f) => ({
          name: f,
          size: fs.statSync(path.join(userDir, f)).size,
          originalName: f.replace(/^\d+-/, ''),
        })),
      };
    });

    res.json({ users: result });
  } catch (err) {
    console.error('Error listing users:', err);
    res.status(500).json({ error: '无法读取用户列表' });
  }
});

// --- Download all as zip (admin) ---
app.get('/api/download-all', requireAdmin, (req, res) => {
  const coll = req.query.collection || 'experiment';
  const baseDir = collectionDir(coll);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${coll}-files-${Date.now()}.zip`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    res.status(500).send({ error: '打包失败' });
    console.error('Archive error:', err);
  });
  archive.pipe(res);

  if (!fs.existsSync(baseDir)) { archive.finalize(); return; }

  const users = fs.readdirSync(baseDir).filter((entry) =>
    fs.statSync(path.join(baseDir, entry)).isDirectory()
  );

  users.forEach((username) => {
    const userDir = path.join(baseDir, username);
    const files = fs.readdirSync(userDir).filter((f) => fs.statSync(path.join(userDir, f)).isFile());
    files.forEach((file) => {
      const filePath = path.join(userDir, file);
      const originalName = file.replace(/^\d+-/, '');
      archive.file(filePath, { name: `${username}/${originalName}` });
    });
  });

  archive.finalize();
});

// --- Download single user as zip (admin) ---
app.get('/api/download-user/:username', requireAdmin, (req, res) => {
  const coll = req.query.collection || 'experiment';
  const username = sanitize(req.params.username);
  const userDir = path.join(collectionDir(coll), username);

  if (!fs.existsSync(userDir)) return res.status(404).json({ error: '用户不存在' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(username)}-${coll}-files.zip`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    res.status(500).send({ error: '打包失败' });
    console.error('Archive error:', err);
  });
  archive.pipe(res);

  const files = fs.readdirSync(userDir).filter((f) => fs.statSync(path.join(userDir, f)).isFile());
  files.forEach((file) => {
    const filePath = path.join(userDir, file);
    const originalName = file.replace(/^\d+-/, '');
    archive.file(filePath, { name: originalName });
  });

  archive.finalize();
});

// --- Delete file (admin) ---
app.delete('/api/file/:username/:encodedName', requireAdmin, (req, res) => {
  const coll = req.query.collection || 'experiment';
  const username = sanitize(req.params.username);
  const filename = sanitizeFilename(req.params.encodedName);
  const filePath = path.join(collectionDir(coll), username, filename);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });

  try {
    fs.unlinkSync(filePath);
    const userDir = path.join(collectionDir(coll), username);
    const remaining = fs.readdirSync(userDir).filter((f) => fs.statSync(path.join(userDir, f)).isFile());
    if (remaining.length === 0) fs.rmdirSync(userDir);
    res.json({ success: true, message: '文件已删除' });
  } catch (err) {
    console.error('Error deleting file:', err);
    res.status(500).json({ error: '删除文件失败' });
  }
});

// --- Delete user (admin) ---
app.delete('/api/user/:username', requireAdmin, (req, res) => {
  const coll = req.query.collection || 'experiment';
  const username = sanitize(req.params.username);
  const userDir = path.join(collectionDir(coll), username);

  if (!fs.existsSync(userDir)) return res.status(404).json({ error: '用户不存在' });

  try {
    fs.rmSync(userDir, { recursive: true, force: true });
    res.json({ success: true, message: `用户 ${username} 及其所有文件已删除` });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: '删除用户失败' });
  }
});

// --- Start Server ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`文件收集站已启动:`);
  console.log(`   实验作业: http://localhost:${PORT}`);
  console.log(`   数学建模: http://localhost:${PORT}/modeling`);
  console.log(`   管理后台: http://localhost:${PORT}/admin`);
  console.log(`   上传目录: ${UPLOADS_DIR}`);
});
