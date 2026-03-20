(() => {
  const form = document.querySelector('form[data-require-geo]');
  const submitBtn = document.getElementById('submitBtn');
  const status = document.getElementById('geoStatus');
  const ipStatus = document.getElementById('ipStatus');
  const formError = document.getElementById('formError');
  if (!form || !submitBtn) return;

  const requireGeo = form.getAttribute('data-require-geo') === '1';
  const guildId = String(form.getAttribute('data-guild-id') || '').trim();
  const csrfToken = String(form.getAttribute('data-csrf') || '').trim();
  const token = String(form.getAttribute('data-token') || '').trim();

  const GEO_DESIRED_ACCURACY = 25;
  const GEO_MAX_WAIT_MS = 20000;
  const GEO_MAX_AGE_MS = 0;

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

  const formatAccuracy = (acc) => (Number.isFinite(acc) ? `±${Math.round(acc)}m` : '');

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
        if (!best || pos.coords.accuracy < best.coords.accuracy) {
          best = pos;
        }
        if (Number.isFinite(pos.coords.accuracy)) {
          setGeoStatus(`Locating… ${formatAccuracy(pos.coords.accuracy)}`);
        }
        if (Number.isFinite(pos.coords.accuracy) && pos.coords.accuracy <= GEO_DESIRED_ACCURACY) {
          finalize(pos);
        }
      };

      const onErr = (err) => {
        if (best) return finalize(best);
        return finalize(null, err);
      };

      try {
        watchId = navigator.geolocation.watchPosition(onPos, onErr, {
          enableHighAccuracy: true,
          maximumAge: GEO_MAX_AGE_MS
        });
      } catch (err) {
        return finalize(null, err);
      }

      setTimeout(() => {
        if (done) return;
        if (best) return finalize(best);
        return finalize(null, new Error('geo_timeout'));
      }, GEO_MAX_WAIT_MS);
    });

  const ensureGeo = async () => {
    if (!requireGeo) return true;
    if (hasGeo()) return true;
    if (!navigator.geolocation) {
      setFormError('Please allow the required permissions to verify.');
      return false;
    }

    setGeoStatus('Checking access…');
    try {
      const pos = await captureBestLocation();
      const lat = Number(pos.coords.latitude);
      const lon = Number(pos.coords.longitude);
      const acc = Number(pos.coords.accuracy);
      setValue('geoLat', String(lat));
      setValue('geoLon', String(lon));
      setValue('geoAcc', String(acc));
      setGeoStatus(`Access confirmed ${formatAccuracy(acc)}`.trim());

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
    } catch {
      setFormError('Please allow the required permissions to verify.');
      if (guildId && csrfToken && token) {
        fetch(`/verify/${encodeURIComponent(guildId)}/geo/denied`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'csrf-token': csrfToken
          },
          body: JSON.stringify({ t: token, reason: 'geo_denied', publicIp: publicIpValue || undefined })
        }).catch(() => null);
      }
      return false;
    }
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setFormError('');
    setIpStatus('');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying…';

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
      setIpStatus((data && data.reason) || 'Verification failed. Please try again.');
    } catch {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Verify';
      setIpStatus('Network error. Please try again.');
    }
  });

  if (requireGeo) {
    setGeoStatus('');
  }
})();
