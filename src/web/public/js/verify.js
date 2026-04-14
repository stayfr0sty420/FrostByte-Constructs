(() => {
  const form = document.querySelector('form[data-require-geo]');
  const submitBtn = document.getElementById('submitBtn');
  const retryBtn = document.getElementById('retryBtn');
  const status = document.getElementById('geoStatus');
  const ipStatus = document.getElementById('ipStatus');
  const formError = document.getElementById('formError');
  const locationError = document.getElementById('locationError');
  if (!form || !submitBtn) return;

  const requireGeo = form.getAttribute('data-require-geo') === '1';
  const guildId = String(form.getAttribute('data-guild-id') || '').trim();
  const csrfToken = String(form.getAttribute('data-csrf') || '').trim();
  const token = String(form.getAttribute('data-token') || '').trim();
  const GEO_OPTIONS = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  };

  let publicIpValue = '';
  let contextPromise = null;
  let lastContext = {
    ready: false,
    blocked: false,
    reason: '',
    message: '',
    permissionState: 'unknown'
  };
  let verifyBusy = false;

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };

  const getValue = (id) => {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  };

  const parseGeoInput = () => {
    const latRaw = getValue('geoLat');
    const lonRaw = getValue('geoLon');
    const accuracyRaw = getValue('geoAcc');
    if (!latRaw || !lonRaw || !accuracyRaw) return null;

    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    const accuracy = Number(accuracyRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(accuracy)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    if (accuracy < 0 || accuracy > 100000) return null;
    return { lat, lon, accuracy };
  };

  const hasGeo = () => Boolean(parseGeoInput());

  const setGeoStatus = (text = '', tone = '') => {
    if (!status) return;
    const value = String(text || '').trim();
    status.textContent = value;
    if (value && tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
    status.hidden = !value;
  };

  const setIpStatus = (text = '') => {
    if (!ipStatus) return;
    ipStatus.textContent = String(text || '').trim();
  };

  const setFormError = (text = '') => {
    if (!formError) return;
    const value = String(text || '').trim();
    formError.textContent = value;
    formError.classList.toggle('d-none', !value);
  };

  const setLoadingState = (loading, label) => {
    submitBtn.disabled = loading;
    submitBtn.classList.toggle('is-loading', loading);
    submitBtn.textContent = loading ? label : 'Verify';
  };

  const setRetryVisible = (visible) => {
    if (!retryBtn) return;
    retryBtn.hidden = !visible;
    retryBtn.disabled = false;
  };

  const disableVerification = (message) => {
    submitBtn.disabled = true;
    submitBtn.classList.remove('is-loading');
    submitBtn.textContent = 'Blocked';
    setRetryVisible(false);
    if (message) setGeoStatus(message, 'danger');
  };

  const clearLocationError = () => {
    if (locationError) locationError.classList.add('d-none');
  };

  const getAnswerInputs = () => Array.from(form.querySelectorAll('input[name^="answer"]'));

  const answersAreComplete = () => getAnswerInputs().every((input) => String(input.value || '').trim());

  async function fetchPublicIp() {
    const urls = ['https://api64.ipify.org?format=json', 'https://api.ipify.org?format=json'];
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) continue;
        const payload = await response.json().catch(() => null);
        const ip = String(payload?.ip || '').trim();
        if (ip) return ip;
      } catch {
        // try the next endpoint
      }
    }
    return '';
  }

  function normalizePermissionState(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'unknown';
    return normalized;
  }

  async function getGeoPermissionState() {
    if (!requireGeo) return 'not_needed';
    if (!window.isSecureContext) return 'insecure';
    if (!navigator.geolocation) return 'unsupported';
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return 'unknown';

    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      return normalizePermissionState(permission?.state || 'unknown');
    } catch {
      return 'unknown';
    }
  }

  async function detectIncognito() {
    const ua = String(navigator.userAgent || '');

    if (window.webkitRequestFileSystem) {
      return await new Promise((resolve) => {
        window.webkitRequestFileSystem(
          window.TEMPORARY,
          1,
          () => resolve({ detected: false, method: 'webkitRequestFileSystem' }),
          () => resolve({ detected: true, method: 'webkitRequestFileSystem' })
        );
      });
    }

    if (/firefox/i.test(ua) && window.indexedDB) {
      return await new Promise((resolve) => {
        let settled = false;
        const request = window.indexedDB.open('verify-private-check');
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        request.onerror = () => finish({ detected: true, method: 'indexedDB' });
        request.onsuccess = () => {
          try {
            request.result.close();
            window.indexedDB.deleteDatabase('verify-private-check');
          } catch {
            // ignore cleanup issues
          }
          finish({ detected: false, method: 'indexedDB' });
        };
      });
    }

    if (/safari/i.test(ua) && !/chrome|android/i.test(ua)) {
      try {
        const key = `verify-private-check-${Date.now()}`;
        window.localStorage.setItem(key, '1');
        window.localStorage.removeItem(key);
        return { detected: false, method: 'localStorage' };
      } catch {
        return { detected: true, method: 'localStorage' };
      }
    }

    if (/chrome|chromium|edg/i.test(ua) && navigator.storage && typeof navigator.storage.estimate === 'function') {
      try {
        const estimate = await navigator.storage.estimate();
        const quota = Number(estimate?.quota || 0);
        if (quota > 0 && quota < 120000000) {
          return { detected: true, method: 'storageQuota' };
        }
        return { detected: false, method: 'storageQuota' };
      } catch {
        return { detected: false, method: 'storageQuota' };
      }
    }

    return { detected: false, method: 'unavailable' };
  }

  async function postClientContext() {
    const permissionState = await getGeoPermissionState();
    setValue('geoPermissionState', permissionState);

    const [incognito, fetchedIp] = await Promise.all([detectIncognito(), fetchPublicIp()]);
    if (fetchedIp) {
      publicIpValue = fetchedIp;
      setValue('publicIp', fetchedIp);
    }

    const response = await fetch(`/verify/${encodeURIComponent(guildId)}/client`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'csrf-token': csrfToken
      },
      body: JSON.stringify({
        t: token,
        publicIp: publicIpValue || undefined,
        incognitoDetected: incognito.detected,
        incognitoMethod: incognito.method,
        geoPermissionState: permissionState
      })
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        blocked: response.status === 403,
        reason: String(data?.reason || '').trim(),
        message: String(data?.message || 'Verification could not continue.').trim(),
        permissionState
      };
    }

    if (data?.publicIp) {
      publicIpValue = String(data.publicIp).trim();
      setValue('publicIp', publicIpValue);
    }

    return {
      ok: true,
      blocked: false,
      reason: '',
      message: '',
      permissionState
    };
  }

  async function ensureClientContext(force = false) {
    if (!force && lastContext.ready) return lastContext;
    if (!force && contextPromise) return contextPromise;

    contextPromise = (async () => {
      const result = await postClientContext();
      lastContext = {
        ready: Boolean(result.ok),
        blocked: Boolean(result.blocked),
        reason: String(result.reason || '').trim(),
        message: String(result.message || '').trim(),
        permissionState: String(result.permissionState || 'unknown').trim() || 'unknown'
      };
      return lastContext;
    })().finally(() => {
      contextPromise = null;
    });

    return contextPromise;
  }

  async function postGeo(payload) {
    await fetch(`/verify/${encodeURIComponent(guildId)}/geo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'csrf-token': csrfToken
      },
      body: JSON.stringify({
        t: token,
        publicIp: publicIpValue || undefined,
        geoPermissionState: getValue('geoPermissionState') || undefined,
        ...payload
      })
    }).catch(() => null);
  }

  async function postGeoDenied(permissionState) {
    await fetch(`/verify/${encodeURIComponent(guildId)}/geo/denied`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'csrf-token': csrfToken
      },
      body: JSON.stringify({
        t: token,
        publicIp: publicIpValue || undefined,
        geoPermissionState: permissionState
      })
    }).catch(() => null);
  }

  async function requestPreciseLocation() {
    const permissionState = await getGeoPermissionState();
    setValue('geoPermissionState', permissionState);

    if (permissionState === 'denied') {
      await postGeoDenied('denied');
      setGeoStatus('Enable location in browser settings to continue.', 'danger');
      setRetryVisible(true);
      return { ok: false, reason: 'denied' };
    }

    if (permissionState === 'unsupported') {
      disableVerification('This browser does not support device location. Use a supported browser to continue.');
      return { ok: false, reason: 'unsupported' };
    }

    if (permissionState === 'insecure') {
      disableVerification('This page must be opened in a secure browser session (HTTPS) before location can be used.');
      return { ok: false, reason: 'insecure' };
    }

    setGeoStatus('Waiting for location permission. Allow it to continue verification.', 'warning');
    setRetryVisible(false);

    return await new Promise((resolve) => {
      try {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const latitude = Number(position?.coords?.latitude);
            const longitude = Number(position?.coords?.longitude);
            const accuracy = Number(position?.coords?.accuracy);

            if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)) {
              setGeoStatus('We could not read a valid location from this device. Press Retry to try again.', 'warning');
              setRetryVisible(true);
              resolve({ ok: false, reason: 'invalid_position' });
              return;
            }

            setValue('geoLat', String(latitude));
            setValue('geoLon', String(longitude));
            setValue('geoAcc', String(accuracy));
            setValue('geoPermissionState', 'granted');
            clearLocationError();
            setGeoStatus(`Precise location linked successfully (accuracy +/-${Math.round(accuracy)}m).`, 'success');
            await postGeo({ lat: latitude, lon: longitude, accuracy });
            resolve({ ok: true });
          },
          async (error) => {
            const latestPermission = await getGeoPermissionState();
            setValue('geoPermissionState', latestPermission);

            if (Number(error?.code) === 1) {
              await postGeoDenied(latestPermission === 'unknown' ? 'denied' : latestPermission);
              if (latestPermission === 'denied') {
                setGeoStatus('Enable location in browser settings to continue.', 'danger');
              } else {
                setGeoStatus('Location access was declined. Press Retry when you are ready to allow it.', 'warning');
              }
              setRetryVisible(true);
              resolve({ ok: false, reason: 'permission_denied' });
              return;
            }

            if (Number(error?.code) === 3) {
              setGeoStatus('Location request timed out. Press Retry to try again.', 'warning');
              setRetryVisible(true);
              resolve({ ok: false, reason: 'timeout' });
              return;
            }

            setGeoStatus('We could not fetch your location. Press Retry to try again.', 'warning');
            setRetryVisible(true);
            resolve({ ok: false, reason: 'position_unavailable' });
          },
          GEO_OPTIONS
        );
      } catch {
        setGeoStatus('We could not start the location request in this browser. Press Retry to try again.', 'warning');
        setRetryVisible(true);
        resolve({ ok: false, reason: 'geo_failed' });
      }
    });
  }

  async function submitVerification() {
    const formData = new FormData(form);
    const body = new URLSearchParams();
    formData.forEach((value, key) => body.append(key, String(value)));

    const response = await fetch(form.getAttribute('action') || window.location.pathname, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'x-verification-ajax': '1'
      },
      body,
      credentials: 'same-origin'
    });

    if (response.redirected && response.url) {
      window.location.href = response.url;
      return;
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = String(data?.reason || 'Verification could not continue. Please try again.').trim();
      setFormError(message);
      if (String(data?.error || '').trim() === 'location_required') {
        setGeoStatus(message, 'danger');
        setRetryVisible(true);
      }
      throw new Error(message);
    }

    if (data?.ok && data?.redirect) {
      window.location.href = data.redirect;
      return;
    }

    throw new Error('Verification could not continue. Please try again.');
  }

  async function startVerification({ forceContext = false } = {}) {
    if (verifyBusy) return;

    setFormError('');
    setIpStatus('');

    if (!answersAreComplete()) {
      setFormError('Please answer all verification questions before continuing.');
      return;
    }

    verifyBusy = true;
    setLoadingState(true, requireGeo ? 'Checking location' : 'Verifying');

    try {
      const context = await ensureClientContext(forceContext);
      setValue('geoPermissionState', context.permissionState);

      if (context.blocked) {
        disableVerification(context.message);
        return;
      }

      if (!context.ready) {
        setGeoStatus(context.message || 'Network safety check is unavailable right now. Please retry.', 'warning');
        setRetryVisible(true);
        setLoadingState(false);
        return;
      }

      if (requireGeo && !hasGeo()) {
        const geoResult = await requestPreciseLocation();
        if (!geoResult.ok) {
          setLoadingState(false);
          return;
        }
      }

      setLoadingState(true, 'Verifying');
      await submitVerification();
    } catch (error) {
      setIpStatus(String(error?.message || 'Verification could not continue. Please try again.'));
      setLoadingState(false);
    } finally {
      verifyBusy = false;
    }
  }

  function applyInitialStatus(permissionState) {
    if (!requireGeo) {
      setGeoStatus('Press Verify to continue through the security checks.', 'warning');
      return;
    }

    if (hasGeo()) {
      setGeoStatus('Precise location is already linked. Press Verify to continue.', 'success');
      setRetryVisible(false);
      return;
    }

    if (permissionState === 'denied') {
      setGeoStatus('Enable location in browser settings to continue.', 'danger');
      setRetryVisible(true);
      return;
    }

    if (permissionState === 'granted') {
      setGeoStatus('Press Verify to capture your current device location and continue.', 'warning');
      setRetryVisible(false);
      return;
    }

    if (permissionState === 'unsupported') {
      disableVerification('This browser does not support device location. Use a supported browser to continue.');
      return;
    }

    if (permissionState === 'insecure') {
      disableVerification('This page must be opened in a secure browser session (HTTPS) before location can be used.');
      return;
    }

    setGeoStatus('Press Verify and allow location access to continue.', 'warning');
    setRetryVisible(false);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await startVerification({ forceContext: true });
  });

  retryBtn?.addEventListener('click', async () => {
    setFormError('');
    setIpStatus('');
    await startVerification({ forceContext: true });
  });

  (async () => {
    const permissionState = await getGeoPermissionState();
    setValue('geoPermissionState', permissionState);
    applyInitialStatus(permissionState);

    const context = await ensureClientContext().catch(() => ({
      ready: false,
      blocked: false,
      message: 'Network safety check is unavailable right now. Please retry.',
      permissionState
    }));

    if (context.blocked) {
      disableVerification(context.message);
      return;
    }

    if (!context.ready) {
      setGeoStatus(context.message || 'Network safety check is unavailable right now. Please retry.', 'warning');
      setRetryVisible(true);
      return;
    }

    applyInitialStatus(context.permissionState || permissionState);
  })().catch(() => null);
})();
