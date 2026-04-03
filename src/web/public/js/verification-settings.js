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
    setStatus('Saving...', 'saving');

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

  form.addEventListener('change', () => {
    queueSave();
  });
  form.addEventListener('input', (event) => {
    if (event.target && ['questionPrompt', 'questionAcceptableAnswers', 'questions'].includes(event.target.name)) queueSave();
  });

  const escapeSelector = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/(["\\.#:[\],])/g, '\\$1');
  };

  const createToken = (option, kind, placeholder, preferEmptyLabel = false) => {
    const selected = document.createElement('span');
    selected.className = 'wick-select__token';

    if (!option || !option.value) {
      const empty = document.createElement('span');
      empty.className = 'wick-select__placeholder';
      empty.textContent = preferEmptyLabel ? String(option?.textContent || '').trim() || placeholder || 'Select an option' : (placeholder || 'Select an option');
      selected.appendChild(empty);
      return selected;
    }

    const accent = document.createElement('span');
    accent.className = `wick-select__accent wick-select__accent--${kind}`;
    if (kind === 'role') {
      const color = String(option.getAttribute('data-color') || '').trim();
      if (color) accent.style.setProperty('--wick-accent', color);
    } else {
      accent.textContent = '#';
    }

    const label = document.createElement('span');
    label.className = 'wick-select__token-label';
    label.textContent = String(option.textContent || '').trim() || placeholder || 'Select an option';

    selected.append(accent, label);
    return selected;
  };

  const wickInstances = [];

  const closeAllWickSelects = (except = null) => {
    wickInstances.forEach((instance) => {
      if (instance !== except) instance.close();
    });
  };

  const enhanceSelect = (select) => {
    const kind = String(select.dataset.wickSelect || 'channel').trim().toLowerCase();
    const placeholder = String(select.dataset.placeholder || 'Select an option').trim();
    const searchPlaceholder = String(select.dataset.searchPlaceholder || 'Search...').trim();

    const wrapper = document.createElement('div');
    wrapper.className = `wick-select wick-select--${kind}`;

    const control = document.createElement('div');
    control.className = 'wick-select__control';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'wick-select__trigger';

    const valueEl = document.createElement('span');
    valueEl.className = 'wick-select__value';

    const chevron = document.createElement('span');
    chevron.className = 'wick-select__chevron';
    chevron.innerHTML = '&#9662;';

    trigger.append(valueEl, chevron);

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'wick-select__clear';
    clearButton.setAttribute('aria-label', `Clear ${placeholder.toLowerCase()}`);
    clearButton.textContent = '×';

    control.append(trigger, clearButton);

    const panel = document.createElement('div');
    panel.className = 'wick-select__panel';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'wick-select__search';
    search.placeholder = searchPlaceholder;
    search.autocomplete = 'off';

    const list = document.createElement('div');
    list.className = 'wick-select__list';

    const empty = document.createElement('div');
    empty.className = 'wick-select__empty';
    empty.textContent = 'No matching options.';

    panel.append(search, list, empty);
    wrapper.append(control, panel);
    select.insertAdjacentElement('afterend', wrapper);
    select.classList.add('wick-select-native');
    select.setAttribute('data-wick-enhanced', '1');

    const updateControl = () => {
      const selectedOption = select.selectedOptions && select.selectedOptions[0] ? select.selectedOptions[0] : select.options[0];
      valueEl.innerHTML = '';
      valueEl.appendChild(createToken(selectedOption, kind, placeholder));
      clearButton.hidden = !selectedOption || !selectedOption.value;
    };

    const renderOptions = () => {
      const query = String(search.value || '').trim().toLowerCase();
      list.innerHTML = '';
      let visibleCount = 0;

      Array.from(select.options).forEach((option) => {
        const label = String(option.textContent || '').trim();
        const normalized = label.toLowerCase();
        if (query && option.value && !normalized.includes(query)) return;

        visibleCount += 1;
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'wick-select__option';
        if (option.selected) optionButton.classList.add('is-selected');
        if (!option.value) optionButton.classList.add('is-empty');
        optionButton.dataset.value = option.value;

        const token = createToken(option, kind, placeholder, true);
        token.classList.add('wick-select__token--option');
        optionButton.appendChild(token);

        optionButton.addEventListener('click', () => {
          if (select.value !== option.value) {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          close();
        });

        list.appendChild(optionButton);
      });

      empty.hidden = visibleCount > 0;
    };

    const open = () => {
      closeAllWickSelects(instance);
      wrapper.classList.add('is-open');
      panel.hidden = false;
      renderOptions();
      search.value = '';
      renderOptions();
      window.requestAnimationFrame(() => search.focus());
    };

    const close = () => {
      wrapper.classList.remove('is-open');
      panel.hidden = true;
      search.value = '';
    };

    trigger.addEventListener('click', () => {
      if (wrapper.classList.contains('is-open')) {
        close();
      } else {
        open();
      }
    });

    clearButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (select.value) {
        select.value = '';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close();
    });

    search.addEventListener('input', () => {
      renderOptions();
    });

    select.addEventListener('change', () => {
      updateControl();
      renderOptions();
    });

    const instance = {
      element: wrapper,
      close
    };

    wickInstances.push(instance);
    panel.hidden = true;
    updateControl();
    return instance;
  };

  document.querySelectorAll('select[data-wick-select]').forEach((select) => {
    if (!select.hasAttribute('data-wick-enhanced')) enhanceSelect(select);
  });

  document.addEventListener('click', (event) => {
    wickInstances.forEach((instance) => {
      if (!instance.element.contains(event.target)) instance.close();
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllWickSelects();
  });

  const updateRolePreview = (select) => {
    const preview = document.querySelector(`[data-role-preview="${escapeSelector(select.id)}"]`);
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
        <div class="flex-grow-1 d-grid gap-2">
          <input class="form-control" name="questionPrompt" placeholder="Enter a question" />
          <textarea class="form-control" name="questionAcceptableAnswers" rows="2" placeholder="Acceptable answers, one per line"></textarea>
        </div>
        <button class="btn btn-outline-danger btn-sm icon-btn" type="button" data-question-remove aria-label="Remove question">🗑️</button>
      `;
      list.appendChild(row);
      bindRemove(row.querySelector('[data-question-remove]'));
      const input = row.querySelector('input[name="questionPrompt"]');
      if (input) input.focus();
      updateQuestionControls();
      queueSave();
    });
    updateQuestionControls();
  }

  setStatus('Auto-save enabled');
})();
