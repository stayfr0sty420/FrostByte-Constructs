(() => {
  const form = document.querySelector('form[data-autosave]');
  if (!form) return;

  const statusEls = Array.from(document.querySelectorAll('[data-autosave-status], [data-autosave-status-floating]'));
  const dock = document.querySelector('[data-autosave-dock]');
  let saveTimer = null;
  let lastPayload = '';
  let saving = false;
  let pendingPayload = '';

  const setStatus = (text, mode = '') => {
    statusEls.forEach((statusEl) => {
      statusEl.textContent = text || '';
      statusEl.classList.remove('is-saving', 'is-warning', 'is-error', 'is-ok');
      if (mode) statusEl.classList.add(`is-${mode}`);
    });
    if (dock) {
      dock.classList.remove('is-saving', 'is-warning', 'is-error', 'is-ok', 'is-pulse');
      if (mode) dock.classList.add(`is-${mode}`);
      dock.classList.add('is-pulse');
      window.clearTimeout(dock._pulseTimer);
      dock._pulseTimer = window.setTimeout(() => dock.classList.remove('is-pulse'), 1200);
    }
  };

  const serializeForm = () => {
    const formData = new FormData(form);
    const body = new URLSearchParams();
    formData.forEach((value, key) => body.append(key, String(value)));
    return body;
  };

  const autoSave = async () => {
    const body = serializeForm();
    const payload = body.toString();
    if (!payload || payload === lastPayload) return;
    if (saving) {
      pendingPayload = payload;
      return;
    }

    saving = true;
    pendingPayload = '';
    setStatus('Saving…', 'saving');

    try {
      const res = await fetch(form.getAttribute('action') || window.location.pathname, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-settings-autosave': '1'
        },
        body
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data && data.reason) || 'Save failed.');
      lastPayload = payload;
      if (data && data.warning) {
        setStatus(data.warning, 'warning');
      } else {
        setStatus('Saved', 'ok');
      }
    } catch {
      setStatus('Save failed. Try again.', 'error');
    } finally {
      saving = false;
      if (pendingPayload && pendingPayload !== lastPayload) {
        autoSave();
      }
    }
  };

  const queueSave = () => {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(autoSave, 400);
  };

  form.addEventListener('change', (event) => {
    if (event.target && event.target.hasAttribute('data-filter-input')) return;
    queueSave();
  });
  form.addEventListener('input', (event) => {
    if (event.target && event.target.name === 'questions') queueSave();
  });

  document.querySelectorAll('[data-filter-input]').forEach((input) => {
    const targetId = input.getAttribute('data-filter-input');
    const select = targetId ? document.getElementById(targetId) : null;
    if (!select) return;
    input.addEventListener('input', () => {
      const query = String(input.value || '').trim().toLowerCase();
      Array.from(select.options).forEach((opt) => {
        const label = String(opt.textContent || '').toLowerCase();
        if (!query || !opt.value || label.includes(query)) {
          opt.hidden = false;
        } else {
          opt.hidden = true;
        }
      });
    });
  });

  const updateRolePreview = (select) => {
    const preview = document.querySelector(`[data-role-preview="${select.id}"]`);
    if (!preview) return;
    const opt = select.selectedOptions && select.selectedOptions[0];
    if (!opt || !opt.value) {
      preview.innerHTML = '<span class="text-muted small">No role selected.</span>';
      return;
    }
    const color = String(opt.getAttribute('data-color') || '').trim() || '#f87171';
    const name = String(opt.textContent || '').trim();
    preview.innerHTML = `<span class="role-pill" style="--role-color:${color}">${name}</span>`;
  };

  document.querySelectorAll('[data-role-select]').forEach((select) => {
    updateRolePreview(select);
    select.addEventListener('change', () => {
      updateRolePreview(select);
      queueSave();
    });
  });

  const list = document.querySelector('[data-question-list]');
  const addBtn = document.querySelector('[data-question-add]');

  const updateQuestionControls = () => {
    if (!list || !addBtn) return;
    const rows = list.querySelectorAll('.question-row');
    addBtn.disabled = rows.length >= 3;
  };

  const bindRemove = (btn) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (!list) return;
      const rows = list.querySelectorAll('.question-row');
      if (rows.length <= 1) return;
      const row = btn.closest('.question-row');
      if (row) row.remove();
      updateQuestionControls();
      queueSave();
    });
  };

  if (list && addBtn) {
    list.querySelectorAll('[data-question-remove]').forEach(bindRemove);
    addBtn.addEventListener('click', () => {
      const rows = list.querySelectorAll('.question-row');
      if (rows.length >= 3) {
        setStatus('Max 3 questions.', 'warning');
        return;
      }
      const row = document.createElement('div');
      row.className = 'question-row';
      row.innerHTML = `
        <input class="form-control" name="questions" placeholder="Enter a question" required />
        <button class="btn btn-outline-danger btn-sm icon-btn" type="button" data-question-remove aria-label="Remove question">🗑️</button>
      `;
      list.appendChild(row);
      bindRemove(row.querySelector('[data-question-remove]'));
      const input = row.querySelector('input');
      if (input) input.focus();
      updateQuestionControls();
      queueSave();
    });
    updateQuestionControls();
  }

  setStatus('Auto-save enabled');
})();
