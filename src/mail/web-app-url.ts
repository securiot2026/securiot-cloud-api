import { Logger } from '@nestjs/common';

export const DEFAULT_WEB_APP_URL = 'http://localhost:4200';

const logger = new Logger('WebAppUrl');

/**
 * Base URL of the Web App used to build links that carry a credential (password reset) or
 * point users back to the app (alert emails). It comes only from the WEB_APP_URL env var,
 * read at call time, and never from request headers (Host, Origin, Referer, X-Forwarded-*).
 *
 * Only http and https are accepted, URLs with embedded credentials are rejected, query and
 * fragment are dropped and trailing slashes removed. Anything doubtful falls back to the default.
 */
export function resolveWebAppBaseUrl(): string {
  const raw = (process.env.WEB_APP_URL ?? '').trim();
  if (raw === '') {
    return DEFAULT_WEB_APP_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    logger.warn(`WEB_APP_URL is not a valid URL, using the default ${DEFAULT_WEB_APP_URL}`);
    return DEFAULT_WEB_APP_URL;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    logger.warn(`WEB_APP_URL must use http or https, using the default ${DEFAULT_WEB_APP_URL}`);
    return DEFAULT_WEB_APP_URL;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    logger.warn(`WEB_APP_URL must not contain credentials, using the default ${DEFAULT_WEB_APP_URL}`);
    return DEFAULT_WEB_APP_URL;
  }

  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}
