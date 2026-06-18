document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('uploadForm');
  const usernameInput = document.getElementById('username');
  const fileInput = document.getElementById('file');
  const fileHint = document.getElementById('fileHint');
  const submitBtn = document.getElementById('submitBtn');
  const btnText = submitBtn.querySelector('.btn-text');
  const btnLoading = submitBtn.querySelector('.btn-loading');
  const message = document.getElementById('message');
  const preview = document.getElementById('preview');
  const previewName = document.getElementById('previewName');
  const previewSize = document.getElementById('previewSize');
  const fileWrapper = document.querySelector('.file-input-wrapper');
  const mainEl = document.querySelector('main');
  const headerEl = document.querySelector('.header');

  // Get collection name from hidden input
  const collection = document.querySelector('input[name="collection"]')?.value || 'experiment';

  // Check if collection is open
  try {
    const statusRes = await fetch('/api/collection/status?collection=' + encodeURIComponent(collection));
    const status = await statusRes.json();

    // Show countdown if there's a deadline and collection is still open
    if (status.deadline && status.open) {
      startCountdown(status.deadline, mainEl, form);
    }

    if (!status.open) {
      mainEl.innerHTML =
        '<div style="text-align:center;padding:60px 0;color:#888;">' +
        '<p style="font-size:32px;margin-bottom:12px;">-</p>' +
        '<p>' + esc(status.message || '该收集暂未开放。') + '</p>' +
        '</div>';
      return;
    }
  } catch {
    // If status check fails, continue showing the form anyway
  }

  // Show file info when selected
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file) {
      fileHint.textContent = file.name;
      previewName.textContent = file.name;
      previewSize.textContent = formatSize(file.size);
      preview.classList.remove('hidden');
    } else {
      fileHint.textContent = '点击选择文件，或拖拽文件到此处';
      preview.classList.add('hidden');
    }
  });

  // Drag & drop visual feedback
  fileWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileWrapper.classList.add('dragover');
  });

  fileWrapper.addEventListener('dragleave', () => {
    fileWrapper.classList.remove('dragover');
  });

  fileWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    fileWrapper.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      fileInput.files = e.dataTransfer.files;
      fileInput.dispatchEvent(new Event('change'));
    }
  });

  // Form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage();

    const username = usernameInput.value.trim();
    const file = fileInput.files[0];

    if (!username) {
      showMessage('请输入您的姓名', 'error');
      usernameInput.focus();
      return;
    }

    if (!file) {
      showMessage('请选择一个文件', 'error');
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      showMessage('文件大小不能超过 500MB', 'error');
      return;
    }

    setLoading(true);

    const formData = new FormData();
    formData.append('username', username);
    formData.append('collection', collection);
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok && result.success) {
        showMessage(result.message, 'success');
        form.reset();
        preview.classList.add('hidden');
        fileHint.textContent = '点击选择文件，或拖拽文件到此处';
      } else {
        showMessage(result.error || '上传失败，请重试', 'error');
      }
    } catch (err) {
      showMessage('网络错误，请检查网络连接后重试', 'error');
    } finally {
      setLoading(false);
    }
  });

  // --- Countdown ---
  function startCountdown(deadlineISO, container, uploadForm) {
    var deadline = new Date(deadlineISO);
    var el = document.createElement('div');
    el.className = 'countdown';
    el.style.cssText =
      'text-align:center;padding:14px 16px;margin-bottom:24px;' +
      'background:#fafafa;border:1px solid #eee;border-radius:10px;' +
      'font-size:14px;color:#555;letter-spacing:0.3px;';
    // Insert after header
    container.insertBefore(el, container.firstChild);

    function tick() {
      var now = Date.now();
      var diff = deadline.getTime() - now;

      if (diff <= 0) {
        el.innerHTML = '<span style="color:#c62828;font-weight:500;">收集已截止</span>';
        if (uploadForm) uploadForm.style.display = 'none';
        return;
      }

      var days = Math.floor(diff / 86400000);
      var hours = Math.floor((diff % 86400000) / 3600000);
      var minutes = Math.floor((diff % 3600000) / 60000);
      var seconds = Math.floor((diff % 60000) / 1000);

      var parts = [];
      if (days > 0) parts.push(days + ' 天');
      parts.push(
        String(hours).padStart(2, '0') + ':' +
        String(minutes).padStart(2, '0') + ':' +
        String(seconds).padStart(2, '0')
      );

      el.innerHTML = '距离截止还有: <strong style="color:#111;font-weight:600;margin-left:4px;">' +
        parts.join(' ') + '</strong>';
    }

    tick();
    setInterval(tick, 1000);
  }

  // Helpers
  function setLoading(loading) {
    submitBtn.disabled = loading;
    btnText.classList.toggle('hidden', loading);
    btnLoading.classList.toggle('hidden', !loading);
  }

  function showMessage(text, type) {
    message.textContent = text;
    message.className = 'message ' + type;
  }

  function hideMessage() {
    message.className = 'message hidden';
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
});
