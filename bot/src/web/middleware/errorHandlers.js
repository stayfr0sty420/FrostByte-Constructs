const { logger } = require('../../config/logger');

function notFoundHandler(req, res, _next) {
  res.status(404);
  if (req.path.startsWith('/api/')) return res.json({ error: 'Not found' });
  return res.render('pages/error', { title: 'Not Found', message: 'Page not found.' });
}

function errorHandler(err, req, res, _next) {
  if (err && err.code === 'EBADCSRFTOKEN') {
    res.status(403);
    if (req.path.startsWith('/api/')) {
      return res.json({ error: 'Invalid CSRF token. Refresh the page and try again.' });
    }
    return res.render('pages/error', {
      title: 'Session Expired',
      message: 'Your session expired or the form token is invalid. Please refresh the page and try again.'
    });
  }

  logger.error({ err }, 'Express error');
  const status = err.status || 500;
  res.status(status);
  if (req.path.startsWith('/api/')) return res.json({ error: err.message || 'Server error' });
  return res.render('pages/error', { title: 'Error', message: err.message || 'Server error.' });
}

module.exports = { errorHandler, notFoundHandler };
