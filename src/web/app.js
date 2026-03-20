const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const csurf = require('csurf');
const rateLimit = require('express-rate-limit');
const passport = require('passport');

const { env } = require('../config/env');
const { logger } = require('../config/logger');
const { configurePassport } = require('./auth/passport');

const { router: indexRouter } = require('./routes/index');
const { router: authRouter } = require('./routes/auth');
const { router: adminAuthRouter } = require('./routes/adminAuth');
const { router: adminRouter } = require('./routes/admin');
const { router: apiRouter } = require('./routes/api');
const { router: verifyRouter } = require('./routes/verify');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandlers');
const { adminSession } = require('./middleware/requireAdmin');

async function createWebApp({ economyClient, backupClient, verificationClient }) {
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.locals.discord = {
    economy: economyClient,
    backup: backupClient,
    verification: verificationClient
  };
  // Back-compat for any legacy routes (prefer app.locals.discord.* instead).
  app.locals.discordClient = verificationClient;

  // Keep CSP strict, but allow public IP lookup for verification flow.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https://api.ipify.org', 'https://api64.ipify.org']
        }
      }
    })
  );
  app.use(compression());
  app.use(cookieParser());

  if (env.NODE_ENV !== 'production') app.use(morgan('dev'));

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 180,
      standardHeaders: 'draft-7',
      legacyHeaders: false
    })
  );

  app.use(
    session({
      name: 'sid',
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000
      },
      store: MongoStore.create({ mongoUrl: env.MONGODB_URI })
    })
  );

  configurePassport(passport);
  app.use(passport.initialize());
  app.use(passport.session());

  // Local admin session (email/password)
  app.use(adminSession);

  // CSRF for non-JSON routes
  const csrfProtection = csurf();
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return csrfProtection(req, res, next);
  });

  const formatDate = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const datePart = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${datePart} ${timePart}`;
  };

  app.use((req, res, next) => {
    res.locals.discordUser = req.user || null;
    res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';
    res.locals.activeGuildId = req.session?.activeGuildId || '';
    const guildId = res.locals.activeGuildId;
    const discord = app.locals.discord;
    const guild =
      (guildId && discord?.verification?.guilds?.cache?.get?.(guildId)) ||
      (guildId && discord?.backup?.guilds?.cache?.get?.(guildId)) ||
      (guildId && discord?.economy?.guilds?.cache?.get?.(guildId)) ||
      null;
    res.locals.activeGuildName = guild?.name || '';
    res.locals.activeGuildIcon = guild?.iconURL?.({ size: 64, extension: 'png' }) || '';
    res.locals.publicBaseUrl = env.PUBLIC_BASE_URL || '';
    res.locals.formatDate = formatDate;
    next();
  });

  // Self-host Bootstrap assets to avoid CSP/CDN issues.
  app.use('/assets/vendor/bootstrap', express.static(path.join(process.cwd(), 'node_modules', 'bootstrap', 'dist')));
  app.use('/assets/images', express.static(path.join(process.cwd(), 'images')));
  app.use('/assets', express.static(path.join(__dirname, 'public')));

  app.use('/', indexRouter);
  app.use('/auth', authRouter);
  app.use('/verify', verifyRouter);
  app.use('/admin', adminAuthRouter);
  app.use('/admin', adminRouter);
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.info('Web app created');
  return app;
}

module.exports = { createWebApp };
