(() => {
  function findConfirmTarget(el) {
    if (!el) return null;
    return el.closest?.('[data-confirm]') || null;
  }

  function initBotSwitcher() {
    const select = document.querySelector('[data-bot-select]');
    const invite = document.querySelector('[data-bot-invite]');
    const preview = document.querySelector('[data-bot-preview]');
    const name = document.querySelector('[data-bot-name]');
    const desc = document.querySelector('[data-bot-desc]');
    const previewWrap = preview ? preview.closest('[data-fallback]') : null;
    if (!select || !invite) return;

    const update = () => {
      const option = select.selectedOptions && select.selectedOptions[0] ? select.selectedOptions[0] : null;
      const key = option ? String(option.getAttribute('data-key') || '').trim() : '';
      const url = option ? String(option.value || '').trim() : '';
      const icon = option ? String(option.getAttribute('data-icon') || '').trim() : '';
      const label = option ? String(option.getAttribute('data-name') || '').trim() : '';
      const text = option ? String(option.getAttribute('data-desc') || '').trim() : '';
      if (url) invite.setAttribute('href', url);
      if (preview && icon) {
        preview.setAttribute('src', icon);
        if (previewWrap) previewWrap.classList.remove('image-failed');
      }
      if (previewWrap) previewWrap.classList.toggle('bot-icon--website', key === 'gods-eye');
      if (name) name.textContent = label || name.textContent;
      if (desc) desc.textContent = text || desc.textContent;
    };

    update();
    select.addEventListener('change', update);
  }

  function initConfirmModal() {
    const modalEl = document.getElementById('appConfirmModal');
    if (!modalEl || !window.bootstrap) return;

    const messageEl = modalEl.querySelector('[data-confirm-message]');
    const titleEl = modalEl.querySelector('[data-confirm-title]');
    const okBtn = modalEl.querySelector('[data-confirm-ok]');
    const cancelBtn = modalEl.querySelector('[data-confirm-cancel]');
    if (!messageEl || !okBtn || !cancelBtn) return;

    const modal = new window.bootstrap.Modal(modalEl, { backdrop: 'static' });
    let pendingTarget = null;
    const defaults = {
      title: 'Confirm action',
      ok: 'Confirm',
      cancel: 'Cancel'
    };

    const handleConfirm = () => {
      const target = pendingTarget;
      pendingTarget = null;
      modal.hide();
      if (!target) return;

      if (target.tagName === 'A' && target.href) {
        window.location.href = target.href;
        return;
      }

      const form = target.closest('form');
      if (form) {
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit(target instanceof HTMLButtonElement ? target : undefined);
        } else {
          form.submit();
        }
      }
    };

    const handleCancel = () => {
      pendingTarget = null;
      modal.hide();
    };

    okBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);

    document.addEventListener('click', (event) => {
      const target = findConfirmTarget(event.target);
      if (!target) return;

      const message = String(target.getAttribute('data-confirm') || '').trim();
      if (!message) return;

      const title = String(target.getAttribute('data-confirm-title') || '').trim() || defaults.title;
      const okLabel = String(target.getAttribute('data-confirm-ok') || '').trim() || defaults.ok;
      const cancelLabel = String(target.getAttribute('data-confirm-cancel') || '').trim() || defaults.cancel;

      event.preventDefault();
      event.stopPropagation();

      pendingTarget = target;
      messageEl.textContent = message;
      if (titleEl) titleEl.textContent = title;
      okBtn.textContent = okLabel;
      cancelBtn.textContent = cancelLabel;
      modal.show();
    });
  }

  function initImageFallbacks() {
    const images = document.querySelectorAll('img[data-fallback-img], img[data-fallback-src]');
    images.forEach((img) => {
      const parent = img.closest('[data-fallback]');
      let fallbackUsed = false;
      const fallbackSrc = String(img.getAttribute('data-fallback-src') || '').trim();

      const tryFallback = () => {
        if (!fallbackSrc || fallbackUsed || img.getAttribute('src') === fallbackSrc) return false;
        fallbackUsed = true;
        img.setAttribute('src', fallbackSrc);
        return true;
      };

      const markFailed = () => parent?.classList.remove('image-loaded');
      const markOk = () => parent?.classList.add('image-loaded');
      if (img.complete) {
        if (img.naturalWidth === 0) {
          if (!tryFallback()) markFailed();
        }
        else markOk();
      }
      img.addEventListener('error', () => {
        if (!tryFallback()) markFailed();
      });
      img.addEventListener('load', markOk);
    });
  }

  function initLogSearch() {
    const input = document.querySelector('[data-log-search]');
    if (!input) return;
    const rows = Array.from(document.querySelectorAll('[data-log-row]'));
    const emptyRow = document.querySelector('[data-log-empty]');
    const countEl = document.querySelector('[data-log-count]');

    const update = () => {
      const q = String(input.value || '').trim().toLowerCase();
      let shown = 0;
      rows.forEach((row) => {
        const hay = String(row.getAttribute('data-search') || '').toLowerCase();
        const show = !q || hay.includes(q);
        row.style.display = show ? '' : 'none';
        if (show) shown += 1;
      });
      if (emptyRow) emptyRow.style.display = shown ? 'none' : '';
      if (countEl) {
        const base = q ? `${shown} result${shown === 1 ? '' : 's'}` : `${rows.length} total`;
        countEl.textContent = base;
      }
    };

    input.addEventListener('input', update);
    update();
  }

  function initFlashAutoHide() {
    const alerts = document.querySelectorAll('.alert:not([data-alert-persist])');
    alerts.forEach((alert) => {
      window.setTimeout(() => {
        alert.classList.add('alert-fade-out');
        window.setTimeout(() => alert.remove(), 300);
      }, 4500);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initBotSwitcher();
      initConfirmModal();
      initImageFallbacks();
      initLogSearch();
      initFlashAutoHide();
    });
  } else {
    initBotSwitcher();
    initConfirmModal();
    initImageFallbacks();
    initLogSearch();
    initFlashAutoHide();
  }
})();
