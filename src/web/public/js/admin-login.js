(() => {
  const root = document.querySelector('[data-admin-passkey]');
  const buttons = Array.from(document.querySelectorAll('[data-passkey-login]'));
  const passwordInput = document.querySelector('[data-password-input]');
  const passwordToggle = document.querySelector('[data-password-toggle]');

  function initAuthFormSubmitGuard() {
    const forms = Array.from(document.querySelectorAll('form.auth-form'));
    if (!forms.length) return;

    const resetFormState = (form) => {
      form.dataset.submitting = 'false';
      form.removeAttribute('aria-busy');
      const submitters = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'));
      submitters.forEach((submitter) => {
        submitter.disabled = false;
        if (submitter instanceof HTMLButtonElement && submitter.dataset.originalLabel) {
          submitter.textContent = submitter.dataset.originalLabel;
        }
      });
    };

    forms.forEach((form) => {
      const submitters = Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]'));
      submitters.forEach((submitter) => {
        if (submitter instanceof HTMLButtonElement && !submitter.dataset.originalLabel) {
          submitter.dataset.originalLabel = submitter.textContent || 'Submit';
        }
      });

      form.addEventListener('submit', (event) => {
        if (form.dataset.submitting === 'true') {
          event.preventDefault();
          return;
        }

        form.dataset.submitting = 'true';
        form.setAttribute('aria-busy', 'true');
        submitters.forEach((submitter) => {
          submitter.disabled = true;
          if (submitter instanceof HTMLButtonElement) {
            submitter.textContent = 'Please wait...';
          }
        });
      });
    });

    window.addEventListener('pageshow', () => {
      forms.forEach(resetFormState);
    });
  }

  if (passwordInput && passwordToggle) {
    passwordToggle.addEventListener('click', () => {
      const visible = passwordInput.getAttribute('type') === 'text';
      passwordInput.setAttribute('type', visible ? 'password' : 'text');
      passwordToggle.textContent = visible ? 'Show' : 'Hide';
      passwordToggle.setAttribute('aria-label', visible ? 'Show password' : 'Hide password');
    });
  }

  initAuthFormSubmitGuard();

  if (!root || !buttons.length) return;

  const statusEl = root.querySelector('[data-passkey-status]');
  const optionsUrl = root.getAttribute('data-options-url') || '';
  const verifyUrl = root.getAttribute('data-verify-url') || '';
  const csrfToken = root.getAttribute('data-csrf') || '';
  const returnTo = root.getAttribute('data-return-to') || '/admin';

  const showStatus = (message, mode = 'info') => {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.remove('d-none', 'alert-info', 'alert-danger', 'alert-success', 'alert-warning');
    statusEl.classList.add(`alert-${mode || 'info'}`);
  };

  const toBuffer = (value) => {
    const input = String(value || '');
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const binary = window.atob(`${normalized}${pad}`);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  };

  const toBase64Url = (value) => {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer || value);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const prepareRequestOptions = (options) => {
    const publicKey = { ...options };
    publicKey.challenge = toBuffer(publicKey.challenge);
    if (Array.isArray(publicKey.allowCredentials)) {
      publicKey.allowCredentials = publicKey.allowCredentials.map((credential) => ({
        ...credential,
        id: toBuffer(credential.id)
      }));
    }
    return publicKey;
  };

  const serializeAuthentication = (credential) => {
    const response = credential.response;
    return {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || null,
      clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
      response: {
        authenticatorData: toBase64Url(response.authenticatorData),
        clientDataJSON: toBase64Url(response.clientDataJSON),
        signature: toBase64Url(response.signature),
        userHandle: response.userHandle ? toBase64Url(response.userHandle) : null
      }
    };
  };

  const setBusy = (busy) => {
    buttons.forEach((button) => {
      button.disabled = busy;
      if (!button.dataset.originalLabel) {
        button.dataset.originalLabel = button.textContent || 'Login with Passkey / QR';
      }
      button.textContent = busy ? 'Waiting for Passkey…' : button.dataset.originalLabel;
    });
  };

  const startPasskeyLogin = async () => {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      showStatus('This browser does not support passkeys.', 'warning');
      return;
    }

    setBusy(true);
    showStatus('Preparing passkey login…', 'info');

    try {
      const optionsRes = await fetch(optionsUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ _csrf: csrfToken, returnTo })
      });
      const optionsData = await optionsRes.json().catch(() => null);
      if (!optionsRes.ok || !optionsData?.ok || !optionsData.options) {
        throw new Error(optionsData?.reason || 'Unable to start passkey login.');
      }

      const publicKey = prepareRequestOptions(optionsData.options);
      const credential = await navigator.credentials.get({ publicKey });
      if (!credential) throw new Error('Passkey login was canceled.');

      showStatus('Verifying passkey…', 'info');
      const verifyRes = await fetch(verifyUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          _csrf: csrfToken,
          response: serializeAuthentication(credential)
        })
      });
      const verifyData = await verifyRes.json().catch(() => null);
      if (!verifyRes.ok || !verifyData?.ok) {
        throw new Error(verifyData?.reason || 'Passkey verification failed.');
      }

      showStatus('Passkey verified. Redirecting…', 'success');
      window.location.href = verifyData.redirect || returnTo;
    } catch (error) {
      showStatus(error?.message || 'Passkey login failed.', 'danger');
    } finally {
      setBusy(false);
    }
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      void startPasskeyLogin();
    });
  });
})();
