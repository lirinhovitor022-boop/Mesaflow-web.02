const crypto = require('node:crypto');
const path = require('node:path');
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');

const requiredEnvironment = ['DATABASE_URL', 'SESSION_SECRET', 'SETUP_KEY'];
const missingEnvironment = requiredEnvironment.filter(name => !process.env[name]);
if (missingEnvironment.length) {
  console.error(`Missing required environment variables: ${missingEnvironment.join(', ')}`);
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32 || process.env.SETUP_KEY.length < 24) {
  console.error('SESSION_SECRET must be at least 32 characters and SETUP_KEY at least 24 characters.');
  process.exit(1);
}

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const isProduction = process.env.NODE_ENV === 'production';
const jsonParser = express.json({ limit: '2mb', strict: true });

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(jsonParser);
app.use(session({
  name: 'mesaflow.sid',
  store: new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12
  }
}));

function emptyRestaurantState(name = '') {
  return {
    restaurant: {
      name,
      legalName: '',
      cnpj: '',
      stateRegistration: '',
      phone: '',
      email: '',
      postalCode: '',
      address: '',
      number: '',
      complement: '',
      district: '',
      city: '',
      state: '',
      serviceChargePercent: 10
    },
    menu: [],
    inventory: [],
    tables: [],
    orders: [],
    transactions: [],
    nextOrder: 1
  };
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS restaurant_state (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      revision BIGINT NOT NULL DEFAULT 1,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function requireSameOrigin(req, res, next) {
  const origin = req.get('origin');
  const host = req.get('host');
  if (!origin || !host) return res.status(403).json({ error: 'Origem da solicitação não autorizada.' });
  try {
    if (new URL(origin).host !== host) return res.status(403).json({ error: 'Origem da solicitação não autorizada.' });
  } catch {
    return res.status(403).json({ error: 'Origem da solicitação inválida.' });
  }
  if (!req.is('application/json')) return res.status(415).json({ error: 'Content-Type application/json é obrigatório.' });
  next();
}

function requireAuthentication(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Sua sessão terminou. Entre novamente.' });
  next();
}

function getUserFromRequest(req, res) {
  if (!req.session.userId) {
    res.status(401).json({ error: 'Sua sessão terminou. Entre novamente.' });
    return null;
  }
  return req.session.userId;
}

function validText(value, maxLength, allowEmpty = true) {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.trim().length > 0);
}

function validState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (!data.restaurant || typeof data.restaurant !== 'object' || Array.isArray(data.restaurant)) return false;
  if (!['menu', 'inventory', 'tables', 'orders', 'transactions'].every(key => Array.isArray(data[key]))) return false;
  if (data.menu.length > 2000 || data.inventory.length > 5000 || data.tables.length > 500 || data.orders.length > 50000 || data.transactions.length > 50000) return false;
  if (!Number.isSafeInteger(data.nextOrder) || data.nextOrder < 1) return false;
  const fields = ['name', 'legalName', 'cnpj', 'stateRegistration', 'phone', 'email', 'postalCode', 'address', 'number', 'complement', 'district', 'city', 'state'];
  if (!fields.every(key => validText(data.restaurant[key], key === 'address' ? 200 : 120))) return false;
  return Number.isFinite(data.restaurant.serviceChargePercent) && data.restaurant.serviceChargePercent >= 0 && data.restaurant.serviceChargePercent <= 100;
}

function timingSafeSecretMatch(candidate, expected) {
  if (typeof candidate !== 'string' || Buffer.byteLength(candidate) !== Buffer.byteLength(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => error ? reject(error) : resolve());
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });
}

function destroySession(req, res) {
  return new Promise((resolve, reject) => {
    req.session.destroy(error => {
      if (error) return reject(error);
      res.clearCookie('mesaflow.sid', { httpOnly: true, secure: isProduction, sameSite: 'lax' });
      resolve();
    });
  });
}

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' }
});

app.get('/api/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/status', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT id, name, email FROM users ORDER BY created_at LIMIT 1');
    const user = req.session.userId ? result.rows.find(row => row.id === req.session.userId) : null;
    res.set('Cache-Control', 'no-store');
    res.json({
      setupAvailable: result.rowCount === 0,
      setupEnabled: Boolean(process.env.SETUP_KEY),
      authenticated: Boolean(user),
      user: user ? { id: user.id, name: user.name, email: user.email } : null
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/setup', requireSameOrigin, authRateLimit, async (req, res, next) => {
  const { setupKey, name, email, password, restaurantName } = req.body || {};
  if (!timingSafeSecretMatch(setupKey, process.env.SETUP_KEY)) return res.status(403).json({ error: 'Chave de configuração inválida.' });
  if (!validText(name, 120, false) || !validText(restaurantName, 120, false) || !validText(email, 254, false) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Informe nome, restaurante e um e-mail válido.' });
  }
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72) {
    return res.status(400).json({ error: 'A senha deve ter pelo menos 12 caracteres e no máximo 72 bytes.' });
  }

  const client = await pool.connect();
  let user;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [734209118]);
    const existing = await client.query('SELECT id FROM users LIMIT 1');
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'A configuração inicial já foi concluída.' });
    }
    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const created = await client.query(
      'INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, email',
      [id, name.trim(), email.trim().toLowerCase(), passwordHash]
    );
    const initialData = emptyRestaurantState(restaurantName.trim());
    await client.query('INSERT INTO restaurant_state (user_id, data) VALUES ($1, $2::jsonb)', [id, JSON.stringify(initialData)]);
    await client.query('COMMIT');
    user = created.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackError => console.error('Setup rollback failed:', rollbackError.message));
    if (error.code === '23505') return res.status(409).json({ error: 'Esse e-mail já está cadastrado.' });
    return next(error);
  } finally {
    client.release();
  }

  try {
    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', requireSameOrigin, authRateLimit, async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!validText(email, 254, false) || typeof password !== 'string' || password.length > 72) {
    return res.status(400).json({ error: 'Informe e-mail e senha.' });
  }
  try {
    const result = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }
    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.set('Cache-Control', 'no-store');
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', requireSameOrigin, requireAuthentication, async (req, res, next) => {
  try {
    await destroySession(req, res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/change-password', requireSameOrigin, requireAuthentication, authRateLimit, async (req, res, next) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 12 || Buffer.byteLength(newPassword) > 72) {
    return res.status(400).json({ error: 'Informe a senha atual e uma nova senha com pelo menos 12 caracteres.' });
  }
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.userId]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) return res.status(401).json({ error: 'A senha atual está incorreta.' });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.session.userId]);
    await destroySession(req, res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/state', requireAuthentication, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT revision, data FROM restaurant_state WHERE user_id = $1', [req.session.userId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Os dados do restaurante não foram encontrados.' });
    res.set('Cache-Control', 'no-store');
    res.json({ revision: result.rows[0].revision, state: result.rows[0].data });
  } catch (error) {
    next(error);
  }
});

app.put('/api/state', requireSameOrigin, requireAuthentication, async (req, res, next) => {
  const { revision, state } = req.body || {};
  if (!Number.isSafeInteger(Number(revision)) || Number(revision) < 1 || !validState(state)) {
    return res.status(400).json({ error: 'Os dados enviados são inválidos ou excedem os limites permitidos.' });
  }
  try {
    const result = await pool.query(
      `UPDATE restaurant_state
       SET data = $1::jsonb, revision = revision + 1, updated_at = NOW()
       WHERE user_id = $2 AND revision = $3
       RETURNING revision`,
      [JSON.stringify(state), req.session.userId, Number(revision)]
    );
    if (!result.rowCount) return res.status(409).json({ error: 'Os dados mudaram em outra sessão. Recarregue para evitar sobrescrever alterações.' });
    res.json({ revision: result.rows[0].revision });
  } catch (error) {
    next(error);
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app.js', (req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'styles.css')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint não encontrado.' }));
app.use((req, res) => res.status(404).type('text').send('Página não encontrada.'));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Request failed:', error.message);
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'A solicitação excede o limite de tamanho.' });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'O JSON enviado é inválido.' });
  res.status(500).json({ error: 'Erro interno. Tente novamente e, se persistir, verifique os logs do servidor.' });
});

const port = Number(process.env.PORT) || 8000;
initializeDatabase().then(() => {
  app.listen(port, '0.0.0.0', () => console.log(`MesaFlow listening on port ${port}`));
}).catch(error => {
  console.error('Could not initialize PostgreSQL:', error.message);
  process.exit(1);
});

async function shutdown() {
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
