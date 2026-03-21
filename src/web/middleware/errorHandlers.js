const { logger } = require('../../config/logger');

function notFoundHandler(req, res, _next) {
  res.status(404);
  if (req.path.startsWith('/api/')) return res.json({ error: 'Not found' });
  return res.render('pages/error', { title: 'Not Found', message: 'Page not found.' });
}

function errorHandler(err, req, res, _next) {
  logger.error({ err }, 'Express error');
  const status = err.status || 500;
  res.status(status);
  if (req.path.startsWith('/api/')) return res.json({ error: err.message || 'Server error' });
  res.locals.activeGuildId = req.session?.activeGuildId || '';
  res.locals.activeGuildName = res.locals.activeGuildName || '';
  res.locals.activeGuildIcon = res.locals.activeGuildIcon || '';
  res.locals.publicBaseUrl = res.locals.publicBaseUrl || '';
  res.locals.csrfToken = res.locals.csrfToken || '';
  if (err && err.code === 'EBADCSRFTOKEN') {
    return res.render('pages/error', {
      title: 'Session expired',
      message: 'Your session token expired. Please refresh the page and try again.'
    });
  }
  return res.render('pages/error', { title: 'Error', message: err.message || 'Server error.' });
}

module.exports = { errorHandler, notFoundHandler };
