(() => {
  const root = document.querySelector('[data-account-passkeys]');
  if (!root) return;

  const registerBtn = root.querySelector('[data-passkey-register]');
  const nameInput = root.querySelector('[data-passkey-name]');
  const statusEl = root.querySelector('[data-passkey-status]');
  const optionsUrl = root.getAttribute('data-options-url') || '';
  const registerUrl = root.getAttribute('data-register-url') || '';
  const csrfToken = root.getAttribute('data-csrf') || '';

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

  const prepareCreationOptions = (options) => {
    const publicKey = { ...options };
    publicKey.challenge = toBuffer(publicKey.challenge);
    if (publicKey.user && publicKey.user.id) {
      publicKey.user = { ...publicKey.user, id: toBuffer(publicKey.user.id) };
    }
    if (Array.isArray(publicKey.excludeCredentials)) {
      publicKey.excludeCredentials = publicKey.excludeCredentials.map((credential) => ({
        ...credential,
        id: toBuffer(credential.id)
      }));
    }
    return publicKey;
  };

  const serializeRegistration = (credential) => {
    const response = credential.response;
    return {
      id: credential.id,
      rawId: toBase64Url(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || null,
      clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
      response: {
        attestationObject: toBase64Url(response.attestationObject),
        clientDataJSON: toBase64Url(response.clientDataJSON),
        transports: typeof response.getTransports === 'function' ? response.getTransports() : []
      }
    };
  };

  const setBusy = (busy) => {
    if (!registerBtn) return;
    registerBtn.disabled = busy;
    registerBtn.textContent = busy ? 'Waiting for Passkey…' : 'Add Security Passkey';
  };

  if (!registerBtn || !optionsUrl || !registerUrl) return;

  registerBtn.addEventListener('click', async () => {
    if (!window.PublicKeyCredential || !navigator.credentials) {
      showStatus('This browser does not support passkeys.', 'warning');
      return;
    }

    setBusy(true);
    showStatus('Preparing passkey setup…', 'info');

    try {
      const optionsRes = await fetch(optionsUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({ _csrf: csrfToken })
      });
      const optionsData = await optionsRes.json().catch(() => null);
      if (!optionsRes.ok || !optionsData?.ok || !optionsData.options) {
        throw new Error(optionsData?.reason || 'Unable to start passkey setup.');
      }

      const publicKey = prepareCreationOptions(optionsData.options);
      const credential = await navigator.credentials.create({ publicKey });
      if (!credential) throw new Error('Passkey creation was canceled.');

      showStatus('Verifying passkey…', 'info');
      const verifyRes = await fetch(registerUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          _csrf: csrfToken,
          passkeyName: nameInput ? nameInput.value : '',
          response: serializeRegistration(credential)
        })
      });
      const verifyData = await verifyRes.json().catch(() => null);
      if (!verifyRes.ok || !verifyData?.ok) {
        throw new Error(verifyData?.reason || 'Unable to save passkey.');
      }

      showStatus(verifyData.message || 'Security passkey added.', 'success');
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      showStatus(error?.message || 'Passkey setup failed.', 'danger');
    } finally {
      setBusy(false);
    }
  });
})();
