export const AUTH_DEFAULTS = {
  ACCESS_TOKEN_TTL_SEC: 900, // 15 minutes
  ACCESS_TOKEN_MIN_SEC: 60, // 1 minute
  ACCESS_TOKEN_MAX_SEC: 86400, // 24 hours
  REFRESH_TOKEN_TTL_SEC: 604800, // 7 days
  REFRESH_TOKEN_MIN_SEC: 3600, // 1 hour
  REFRESH_TOKEN_MAX_SEC: 2592000, // 30 days
  COOKIE_PREFIX: 'rt_',
  MAX_COOKIE_HEADER_BYTES: 4096, // 4KB limit on Cookie header
  MAX_AUTH_COOKIES_PARSED: 10, // Cap on recognized rt_ cookies processed per request
  INSECURE_SECRET_FALLBACK: 'dev-secret-no-cambiar',
} as const
