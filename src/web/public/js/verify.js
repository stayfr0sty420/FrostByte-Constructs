(() => {
  const form = document.querySelector('form[data-require-geo]');
  const submitBtn = document.getElementById('submitBtn');
  const status = document.getElementById('geoStatus');
  const ipStatus = document.getElementById('ipStatus');
  const formError = document.getElementById('formError');
  const locationError = document.getElementById('locationError');
  if (!form || !submitBtn) return;

  const requireGeo = form.getAttribute('data-require-geo') === '1';
  const guildId = String(form.getAttribute('data-guild-id') || '').trim();
  const csrfToken = String(form.getAttribute('data-csrf') || '').trim();
  const token = String(form.getAttribute('data-token') || '').trim();

  const GEO_DESIRED_ACCURACY = 65;
  const GEO_GOOD_ACCEPT_ACCURACY = 120;
  const GEO_MAX_ACCEPT_ACCURACY = 200;
  const GEO_MAX_WAIT_MS = 18000;
  const GEO_MAX_AGE_MS = 0;
  const GEO_PRIMARY_TIMEOUT_MS = 12000;

  let publicIpPostedOk = false;
  let publicIpValue = '';

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };

  const getValue = (id) => {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  };

  const parseGeoInput = () => {
    const latStr = getValue('geoLat');
    const lonStr = getValue('geoLon');
    const accStr = getValue('geoAcc');
    if (!latStr || !lonStr || !accStr) return null;
    const lat = Number(latStr);
    const lon = Number(lonStr);
    const acc = Number(accStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(acc)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    if (acc < 0 || acc > 100000) return null;
    return { lat, lon, accuracy: acc };
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

  const setIpStatus = (text) => {
    if (!ipStatus) return;
    const value = String(text || '').trim();
    ipStatus.textContent = value;
    ipStatus.style.display = value ? 'block' : 'none';
  };

  const setFormError = (text) => {
    if (!formError) return;
    const value = String(text || '').trim();
    formError.textContent = value;
    formError.classList.toggle('d-none', !value);
  };

  const clearLocationError = () => {
    if (locationError) locationError.classList.add('d-none');
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('error')) {
        url.searchParams.delete('error');
        window.history.replaceState({}, document.title, url.toString());
      }
    } catch {
      // ignore URL update failures
    }
  };

  const fetchPublicIp = async () => {
    const urls = ['https://api64.ipify.org?format=json', 'https://api.ipify.org?format=json'];
    for (const url of urls) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) continue;
        const data = await r.json().catch(() => null);
        const ip = data && data.ip ? String(data.ip).trim() : '';
        if (ip) return ip;
      } catch {
        // try next
      }
    }
    return '';
  };

  const postPublicIp = async (ip) => {
    try {
      const r = await fetch(`/verify/${encodeURIComponent(guildId)}/client`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'csrf-token': csrfToken
        },
        body: JSON.stringify({ t: token, publicIp: ip })
      });
      if (!r.ok) return false;
      const data = await r.json().catch(() => null);
      return Boolean(data && data.ok === true);
    } catch {
      return false;
    }
  };

  const ensurePublicIp = async () => {
    if (!guildId || !csrfToken || !token) return false;
    if (publicIpPostedOk) return true;
    const ip = publicIpValue || (await fetchPublicIp());
    if (!ip) return false;
    publicIpValue = ip;
    setValue('publicIp', ip);
    const ok = await postPublicIp(ip);
    publicIpPostedOk = ok;
    return ok;
  };

  if (guildId && csrfToken && token) {
    ensurePublicIp().catch(() => null);
  }

  setIpStatus('');

  const captureBestLocation = () =>
    new Promise((resolve, reject) => {
      let best = null;
      let done = false;
      let watchId = null;
      let sampleCount = 0;

      const finalize = (pos, err) => {
        if (done) return;
        done = true;
        if (watchId !== null && navigator.geolocation.clearWatch) {
          navigator.geolocation.clearWatch(watchId);
        }
        if (pos) resolve(pos);
        else reject(err || new Error('geo_failed'));
      };

      const onPos = (pos) => {
        if (!pos || !pos.coords) return;
        sampleCount += 1;
        if (!best || pos.coords.accuracy < best.coords.accuracy) {
          best = pos;
        }
        if (Number.isFinite(pos.coords.accuracy) && pos.coords.accuracy <= GEO_DESIRED_ACCURACY && sampleCount >= 2) {
          return finalize(pos);
        }
        if (Number.isFinite(pos.coords.accuracy) && pos.coords.accuracy <= GEO_GOOD_ACCEPT_ACCURACY && sampleCount >= 3) {
          return finalize(pos);
        }
      };

      const onErr = (err) => {
        const bestAccuracy = Number(best?.coords?.accuracy);
        if (best && Number.isFinite(bestAccuracy) && bestAccuracy <= GEO_MAX_ACCEPT_ACCURACY) {
          return finalize(best);
        }
        const reason =
          err?.code === 1
            ? 'permission_denied'
            : err?.code === 2
              ? 'position_unavailable'
              : err?.code === 3
                ? 'timeout'
                : 'geo_failed';
        return finalize(null, createGeoFailure(reason, err?.message || reason));
      };

      try {
        navigator.geolocation.getCurrentPosition(onPos, onErr, {
          enableHighAccuracy: true,
          maximumAge: GEO_MAX_AGE_MS,
          timeout: GEO_PRIMARY_TIMEOUT_MS
        });
        watchId = navigator.geolocation.watchPosition(onPos, onErr, {
          enableHighAccuracy: true,
          maximumAge: GEO_MAX_AGE_MS
        });
      } catch (err) {
        return finalize(null, err);
      }

      setTimeout(() => {
        if (done) return;
        const bestAccuracy = Number(best?.coords?.accuracy);
        if (best && Number.isFinite(bestAccuracy) && bestAccuracy <= GEO_MAX_ACCEPT_ACCURACY) {
          return finalize(best);
        }
        return finalize(null, createGeoFailure(best ? 'low_accuracy' : 'timeout'));
      }, GEO_MAX_WAIT_MS);
    });

  const getGeoPermissionState = async () => {
    if (!requireGeo) return 'not_needed';
    if (!window.isSecureContext) return 'insecure';
    if (!navigator.geolocation) return 'unsupported';
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return 'unknown';

    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      return String(permission?.state || 'unknown').trim().toLowerCase() || 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const buildGeoStatusCopy = (permissionState) => {
    if (!requireGeo) return '';
    if (hasGeo()) {
      return 'Precise device location is already linked. Verification can continue normally.';
    }

    switch (String(permissionState || '').trim().toLowerCase()) {
      case 'granted':
        return 'This browser already allows device location. A precise reading will be attached automatically when available.';
      case 'denied':
        return 'Browser location is blocked here, but verification will continue using your network location instead.';
      case 'prompt':
        return 'No browser location pop-up is required. Verification uses your network location by default.';
      case 'insecure':
        return 'This page is not in a secure browser context, so verification will use your network location instead.';
      case 'unsupported':
        return 'This browser does not expose device location, so verification will use your network location instead.';
      default:
        return 'Verification uses your network location by default. Device GPS is only attached if it was already allowed in this browser.';
    }
  };

  const refreshGeoStatus = async () => {
    const permissionState = await getGeoPermissionState();
    const tone = hasGeo() ? 'success' : 'warning';
    setGeoStatus(buildGeoStatusCopy(permissionState), tone);
    return permissionState;
  };

  const postGeo = async ({ lat, lon, accuracy }) => {
    if (!guildId || !csrfToken || !token) return;
    await fetch(`/verify/${encodeURIComponent(guildId)}/geo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'csrf-token': csrfToken
      },
      body: JSON.stringify({
        t: token,
        lat,
        lon,
        accuracy,
        publicIp: publicIpValue || undefined
      })
    }).catch(() => null);
  };

  let geoCapturePromise = null;
  const captureGeoSilently = async () => {
    if (!requireGeo || hasGeo() || !navigator.geolocation || !window.isSecureContext) return false;
    if (geoCapturePromise) return geoCapturePromise;

    geoCapturePromise = (async () => {
      const permissionState = await getGeoPermissionState();
      if (permissionState !== 'granted') {
        await refreshGeoStatus();
        return false;
      }

      try {
        const pos = await captureBestLocation();
        const lat = Number(pos.coords.latitude);
        const lon = Number(pos.coords.longitude);
        const acc = Number(pos.coords.accuracy);
        if (!Number.isFinite(acc)) {
          await refreshGeoStatus();
          return false;
        }

        setValue('geoLat', String(lat));
        setValue('geoLon', String(lon));
        setValue('geoAcc', String(acc));
        clearLocationError();
        setGeoStatus('Precise device location is linked. Verification can continue normally.', 'success');
        await postGeo({ lat, lon, accuracy: acc });
        return true;
      } catch {
        setGeoStatus('Verification will use your network location. Precise device GPS could not be refreshed in this browser.', 'warning');
        return false;
      }
    })().finally(() => {
      geoCapturePromise = null;
    });

    return geoCapturePromise;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError('');
    setIpStatus('');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Securing…';

    captureGeoSilently().catch(() => null);
    await ensurePublicIp();

    const formData = new FormData(form);
    const body = new URLSearchParams();
    formData.forEach((value, key) => body.append(key, String(value)));

    try {
      const r = await fetch(form.getAttribute('action') || window.location.pathname, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'x-verification-ajax': '1'
        },
        body,
        credentials: 'same-origin'
      });
      if (r.redirected && r.url) {
        window.location.href = r.url;
        return;
      }
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        const reason = String(data?.reason || '').trim();
        submitBtn.disabled = false;
        submitBtn.textContent = 'Verify';
        if (reason) {
          setFormError(reason);
        } else {
          setIpStatus('Verification could not continue. Please try again.');
        }
        return;
      }
      if (data && data.ok && data.redirect) {
        window.location.href = data.redirect;
        return;
      }
      submitBtn.disabled = false;
      submitBtn.textContent = 'Verify';
      setIpStatus('Verification could not continue. Please try again.');
    } catch {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Verify';
      setIpStatus('Network error. Please try again.');
    }
  });

  if (requireGeo) {
    refreshGeoStatus().catch(() => null);
    captureGeoSilently().catch(() => null);
  }
})();
