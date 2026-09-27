import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { MongoClient } from 'mongodb';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { csrfProtection } from './middleware/csrf.js';
import { loadAuthentication } from './middleware/authentication.js';
import { originGuard, securityHeaders } from './middleware/security.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { apiLimiter } from './middleware/rateLimits.js';
import apiRoutes from './routes/index.js';

export async function createApp() {
  const app = express();
  const sessionClient = new MongoClient(env.mongoUri);
  await sessionClient.connect();
  const mongoStore = MongoStore.create({
    client: sessionClient,
    collectionName: env.sessionCollection,
    ttl: 8 * 60 * 60,
    autoRemove: 'native',
  });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-site' },
    // Google Identity Services loads its client script, opens a popup frame and
    // posts back over https://accounts.google.com. Only those origins are added;
    // every other directive keeps the helmet defaults.
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://accounts.google.com'],
        'frame-src': ["'self'", 'https://accounts.google.com'],
        'connect-src': ["'self'", 'https://accounts.google.com', 'https://*.googleapis.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com', 'https://*.googleusercontent.com'],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'self'"],
      },
    },
    // The default 'same-origin' would sever the opener handle the Google popup
    // needs, so the popup-friendly policy is used instead. This is a narrowing of
    // nothing else: COOP only controls cross-document window references.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  }));
  app.use(securityHeaders);
  app.use(morgan(env.isProduction ? 'combined' : 'dev', { skip: (request) => request.path === '/api/health/' }));
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(cookieParser());
  app.use(session({
    name: 'sessionid',
    secret: env.sessionSecret,
    store: mongoStore,
    resave: false,
    saveUninitialized: true,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.secureCookies,
      maxAge: 8 * 60 * 60 * 1_000,
      path: '/',
    },
  }));
  app.use(originGuard);
  app.use('/api', apiLimiter, csrfProtection, loadAuthentication);
  app.get('/api/health/', (request, response) => response.json({ status: 'ok', database: 'mongodb' }));
  app.use('/api', apiRoutes);
  app.use(notFound);
  app.use(errorHandler);
  app.locals.sessionClient = sessionClient;
  return app;
}
