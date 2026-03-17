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
  return res.render('pages/error', { title: 'Error', message: err.message || 'Server error.' });
}

module.exports = { errorHandler, notFoundHandler };

