import { isProduction, isTestEnv } from './env';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
// Tests keep only errors: a passing suite should be quiet, a failing one loud.
const MIN_LEVEL: Level =
  process.env.LOG_LEVEL === 'debug'
    ? 'debug'
    : isTestEnv
      ? 'error'
      : isProduction
        ? 'info'
        : 'debug';

/**
 * Minimal structured logger. JSON in production so Vercel's log drain can parse
 * it; human-readable lines in development. Deliberately not a library — one
 * fewer dependency to justify in an MVP.
 */
function log(level: Level, message: string, meta?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  if (isProduction) {
    console[level === 'debug' ? 'log' : level](
      JSON.stringify({ level, time: new Date().toISOString(), message, ...meta }),
    );
    return;
  }

  const suffix = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  console[level === 'debug' ? 'log' : level](`[${level.toUpperCase()}] ${message}${suffix}`);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
};
