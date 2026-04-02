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

  const setGeoStatus = (text) => {
    if (status) status.textContent = text || '';
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

  const createGeoFailure = (code, message = code) => {
    const error = new Error(String(message || code || 'geo_failed'));
    error.code = String(code || 'geo_failed');
    return error;
  };

  const formatAccuracy = (accuracy) => {
    const value = Number(accuracy);
    return Number.isFinite(value) ? `±${Math.round(value)}m` : '';
  };

  const describeGeoFailure = (code) => {
    const normalized = String(code || '').trim().toLowerCase();
    if (!window.isSecureContext) {
      return 'Precise location requires HTTPS. Open the secure site URL and try again.';
    }
    switch (normalized) {
      case 'permission_denied':
        return 'Location access is required to verify. Allow browser or device location, then try again.';
      case 'position_unavailable':
        return 'Precise location is unavailable right now. Turn on GPS or high-accuracy location, then try again.';
      case 'timeout':
        return 'We could not lock a precise location in time. Keep location services on and try again.';
      case 'low_accuracy':
        return 'Location was detected but it is still too broad. Turn on GPS or high-accuracy mode, then try again.';
      case 'unsupported':
        return 'This browser cannot provide device location for verification.';
      default:
        return 'Precise device location is required to verify. Enable location services and try again.';
    }
  };

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
        const accuracyText = formatAccuracy(pos.coords.accuracy);
        setGeoStatus(accuracyText ? `Locking precise location… (${accuracyText})` : 'Locking precise location…');
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

  const ensureGeo = async () => {
    if (!requireGeo) return true;
    if (hasGeo()) return true;
    if (!window.isSecureContext) {
      setGeoStatus('');
      setFormError(describeGeoFailure('insecure_context'));
      return false;
    }
    if (!navigator.geolocation) {
      setGeoStatus('');
      setFormError(describeGeoFailure('unsupported'));
      return false;
    }

    setGeoStatus('Requesting precise location…');
    try {
      const pos = await captureBestLocation();
      const lat = Number(pos.coords.latitude);
      const lon = Number(pos.coords.longitude);
      const acc = Number(pos.coords.accuracy);
      if (!Number.isFinite(acc)) {
        setGeoStatus('');
        setFormError(describeGeoFailure('position_unavailable'));
        return false;
      }
      setValue('geoLat', String(lat));
      setValue('geoLon', String(lon));
      setValue('geoAcc', String(acc));
      const accuracyText = formatAccuracy(acc);
      setGeoStatus(accuracyText ? `Precise location locked (${accuracyText})` : 'Precise location locked');
      clearLocationError();

      if (guildId && csrfToken && token) {
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
            accuracy: acc,
            publicIp: publicIpValue || undefined
          })
        }).catch(() => null);
      }
      return true;
    } catch (error) {
      setGeoStatus('');
      setFormError(describeGeoFailure(error?.code));
      if (guildId && csrfToken && token) {
        fetch(`/verify/${encodeURIComponent(guildId)}/geo/denied`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'csrf-token': csrfToken
          },
          body: JSON.stringify({ t: token, reason: error?.code || 'geo_denied', publicIp: publicIpValue || undefined })
        }).catch(() => null);
      }
      return false;
    }
  };

  let warmGeoStarted = false;
  const warmGeo = async () => {
    if (!requireGeo || warmGeoStarted || hasGeo() || !navigator.geolocation || !window.isSecureContext) return;
    warmGeoStarted = true;
    setGeoStatus('Requesting precise location…');
    try {
      const pos = await captureBestLocation();
      const lat = Number(pos.coords.latitude);
      const lon = Number(pos.coords.longitude);
      const acc = Number(pos.coords.accuracy);
      if (!Number.isFinite(acc)) return;
      setValue('geoLat', String(lat));
      setValue('geoLon', String(lon));
      setValue('geoAcc', String(acc));
      const accuracyText = formatAccuracy(acc);
      setGeoStatus(accuracyText ? `Precise location locked (${accuracyText})` : 'Precise location locked');
      clearLocationError();
    } catch {
      setGeoStatus('');
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError('');
    setIpStatus('');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Securing…';

    const geoOk = await ensureGeo();
    if (!geoOk) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Verify';
      return;
    }

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
    setGeoStatus('');
    warmGeo().catch(() => null);
  }
})();
