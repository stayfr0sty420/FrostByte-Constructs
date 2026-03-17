(() => {
  const form = document.querySelector('form[data-require-geo]');
  const btn = document.getElementById('geoBtn');
  const submitBtn = document.getElementById('submitBtn');
  const status = document.getElementById('geoStatus');
  const ipStatus = document.getElementById('ipStatus');
  const formError = document.getElementById('formError');
  if (!form || !btn || !submitBtn) return;

  const requireGeo = form.getAttribute('data-require-geo') === '1';
  const guildId = String(form.getAttribute('data-guild-id') || '').trim();
  const csrfToken = String(form.getAttribute('data-csrf') || '').trim();
  const token = String(form.getAttribute('data-token') || '').trim();

  let geoPostedOk = false;
  let publicIpPostedOk = false;
  let publicIpValue = '';

  function setValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function getValue(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function hasGeo() {
    const lat = getValue('geoLat');
    const lon = getValue('geoLon');
    const acc = getValue('geoAcc');
    return Boolean(lat) && Boolean(lon) && Boolean(acc);
  }

  function setGeoStatus(text) {
    if (status) status.textContent = text || '';
  }

  function setIpStatus(text) {
    if (!ipStatus) return;
    const value = String(text || '').trim();
    ipStatus.textContent = value;
    ipStatus.style.display = value ? 'block' : 'none';
  }

  function setFormError(text) {
    if (!formError) return;
    const value = String(text || '').trim();
    formError.textContent = value;
    formError.classList.toggle('d-none', !value);
  }

  function clearServerError() {
    setFormError('');
  }

  function updateVerifyEnabled() {
    const geoOk = !requireGeo || hasGeo();
    submitBtn.disabled = !geoOk;
  }

  function updateGeoStatus() {
    if (!requireGeo) {
      setGeoStatus('');
      return;
    }
    if (hasGeo()) setGeoStatus('Location captured.');
    else setGeoStatus('Location required.');
  }

  updateGeoStatus();
  updateVerifyEnabled();
  setIpStatus('');

  async function fetchPublicIp() {
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
  }

  async function postPublicIp(ip) {
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
  }

  async function ensurePublicIp() {
    if (!guildId || !csrfToken || !token) return false;
    if (publicIpPostedOk) return true;
    const ip = publicIpValue || (await fetchPublicIp());
    if (!ip) return false;
    publicIpValue = ip;
    const ok = await postPublicIp(ip);
    publicIpPostedOk = ok;
    return ok;
  }

  if (guildId && csrfToken && token) {
    setIpStatus('');
    ensurePublicIp().catch(() => null);
  }

  btn.addEventListener('click', () => {
    clearServerError();
    geoPostedOk = false;
    updateGeoStatus();
    updateVerifyEnabled();

    if (!navigator.geolocation) {
      setGeoStatus('Geolocation not supported.');
      if (guildId && csrfToken && token) {
        fetch(`/verify/${encodeURIComponent(guildId)}/geo/denied`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'csrf-token': csrfToken
          },
          body: JSON.stringify({ t: token, reason: 'geolocation_not_supported', publicIp: publicIpValue || undefined })
        }).catch(() => null);
      }
      return;
    }

    btn.disabled = true;
    setGeoStatus('Requesting location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setValue('geoLat', String(pos.coords.latitude));
        setValue('geoLon', String(pos.coords.longitude));
        setValue('geoAcc', String(pos.coords.accuracy));
        btn.disabled = false;
        geoPostedOk = false;
        updateGeoStatus();
        updateVerifyEnabled();

        if (guildId && csrfToken && token) {
          fetch(`/verify/${encodeURIComponent(guildId)}/geo`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'csrf-token': csrfToken
            },
            body: JSON.stringify({
              t: token,
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              publicIp: publicIpValue || undefined
            })
          })
            .then(async (r) => {
              if (!r.ok) throw new Error('geo_post_failed');
              const data = await r.json().catch(() => null);
              if (!data || data.ok !== true) throw new Error('geo_post_not_ok');
              geoPostedOk = true;
              updateGeoStatus();
              updateVerifyEnabled();
            })
            .catch(() => {
              geoPostedOk = false;
              setGeoStatus('Failed to send location. Please try again.');
              updateGeoStatus();
              updateVerifyEnabled();
            });
        }
      },
      (err) => {
        btn.disabled = false;
        setGeoStatus('Location permission denied.');
        geoPostedOk = false;
        updateGeoStatus();
        updateVerifyEnabled();

        const reason = err && typeof err.code !== 'undefined' ? `geo_error_${err.code}` : 'geo_error';
        if (guildId && csrfToken && token) {
          fetch(`/verify/${encodeURIComponent(guildId)}/geo/denied`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'csrf-token': csrfToken
            },
            body: JSON.stringify({ t: token, reason, publicIp: publicIpValue || undefined })
          }).catch(() => null);
        }
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  // Inputs are optional; no missing-answers validation on client.

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitBtn.disabled) return;
    setIpStatus('');
    clearServerError();

    const geoOk = !requireGeo || hasGeo();
    if (!geoOk) {
      setFormError('Location is required. Please allow location.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Redirecting…';

    const ipOk = await ensurePublicIp();
    if (!ipOk) {
      setIpStatus('');
    }

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
})();
