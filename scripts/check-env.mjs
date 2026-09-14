#!/usr/bin/env node
/**
 * Environment preflight.
 *
 * Compares the keys documented in .env.example against what is actually set,
 * and reports what is missing before you seed or deploy. Run it locally against
 * a .env file, or in a shell where the production variables are exported.
 *
 *   node scripts/check-env.mjs
 *   node scripts/check-env.mjs --seed     # also require the seed credentials
 *
 * It prints values only as "set" or "missing" — never the values themselves.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Loads KEY=VALUE pairs from a file, ignoring comments and blank lines. */
function loadEnvFile(file) {
  try {
    return readFileSync(path.join(root, file), 'utf8')
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#'))
      .reduce((acc, line) => {
        const eq = line.indexOf('=');
        if (eq === -1) return acc;
        acc[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        return acc;
      }, {});
  } catch {
    return null;
  }
}

const REQUIRED = ['NODE_ENV', 'CLIENT_URL', 'MONGODB_URI', 'JWT_SECRET', 'DOCUMENT_LINK_SECRET'];
const REQUIRED_FOR_PAYMENTS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
const REQUIRED_FOR_EMAIL = ['RESEND_API_KEY', 'EMAIL_FROM'];
const REQUIRED_FOR_SEED = ['SEED_AGENT_EMAIL', 'SEED_AGENT_PASSWORD'];
const MIN_SECRET_LENGTH = 32;

const dotEnv = loadEnvFile('.env') ?? {};
const example = loadEnvFile('.env.example');
const resolved = { ...dotEnv, ...process.env };

const value = (key) => (resolved[key] ?? '').trim();
const isSet = (key) => value(key).length > 0;

let failures = 0;

function report(title, keys, { fatal = true } = {}) {
  console.log(`\n${title}`);
  for (const key of keys) {
    if (isSet(key)) {
      console.log(`  ok       ${key}`);
    } else {
      console.log(`  ${fatal ? 'MISSING ' : 'not set '} ${key}`);
      if (fatal) failures += 1;
    }
  }
}

console.log('Environment preflight');
console.log(loadEnvFile('.env') ? '  reading .env plus the current environment' : '  reading the current environment only');

report('Required', REQUIRED);
report('Payments (Stripe) — without these, payment routes return 503', REQUIRED_FOR_PAYMENTS, { fatal: false });
report('Email (Resend) — without these, emails are logged instead of sent', REQUIRED_FOR_EMAIL, { fatal: false });

if (process.argv.includes('--seed')) {
  report('Seed credentials', REQUIRED_FOR_SEED);
}

// Secrets must be long enough for the config schema to accept them.
console.log('\nSecret strength');
for (const key of ['JWT_SECRET', 'DOCUMENT_LINK_SECRET']) {
  const length = value(key).length;
  if (length === 0) continue;
  if (length < MIN_SECRET_LENGTH) {
    console.log(`  TOO SHORT ${key} is ${length} chars; needs ${MIN_SECRET_LENGTH}+`);
    failures += 1;
  } else {
    console.log(`  ok        ${key} (${length} chars)`);
  }
}
if (isSet('JWT_SECRET') && value('JWT_SECRET') === value('DOCUMENT_LINK_SECRET')) {
  console.log('  WARNING   JWT_SECRET and DOCUMENT_LINK_SECRET are identical — use different values');
  failures += 1;
}

// Optional keys from .env.example that were not covered by a section above.
if (example) {
  const alreadyReported = new Set([
    ...REQUIRED,
    ...REQUIRED_FOR_PAYMENTS,
    ...REQUIRED_FOR_EMAIL,
    ...REQUIRED_FOR_SEED,
  ]);
  const unset = Object.keys(example).filter((key) => !alreadyReported.has(key) && !isSet(key));
  if (unset.length > 0) {
    console.log('\nOptional, using defaults');
    unset.forEach((key) => console.log(`  default  ${key}`));
  }
}

if (value('NODE_ENV') === 'production' && value('CLIENT_URL').includes('localhost')) {
  console.log('\n  WARNING  NODE_ENV=production but CLIENT_URL still points at localhost.');
  console.log('           Share links, Stripe redirects and emails will be wrong.');
  failures += 1;
}

console.log(failures === 0 ? '\nAll required variables are present.\n' : `\n${failures} problem(s) to fix.\n`);
process.exit(failures === 0 ? 0 : 1);
