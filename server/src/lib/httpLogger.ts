import type { Logger, SerializedRequest } from 'pino';
import { pinoHttp } from 'pino-http';

/** One log line per request, from the server's logger (app.ts mounts it outside tests). */
export function httpLogger(logger: Logger) {
  return pinoHttp({
    logger,
    serializers: {
      // The path only, never the query string or req.query: a query can hold a phone number
      // (GET /wallets/lookup?phone=), and logs never hold a full phone number.
      req: (req: SerializedRequest) => ({
        id: req.id,
        method: req.method,
        url: req.url.split('?')[0],
        headers: req.headers,
        remoteAddress: req.remoteAddress,
        remotePort: req.remotePort,
      }),
    },
    // Tokens and session cookies must never reach the logs.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[REDACTED]',
    },
  });
}
