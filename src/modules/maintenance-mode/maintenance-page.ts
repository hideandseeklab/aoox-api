/**
 * Maintenance page content: the text a visitor sees while an application is in
 * maintenance mode. Pure functions, no I/O.
 */

export const MAINTENANCE_MESSAGE_MAX = 280;
export const DEFAULT_MAINTENANCE_MESSAGE =
  'We are performing scheduled maintenance. Please check back shortly.';
/** Seconds a visitor (or a crawler) is asked to wait before retrying. */
export const MAINTENANCE_RETRY_AFTER_SECONDS = 300;

/**
 * Plain text from the operator: control characters removed (newlines kept),
 * line endings normalized, trimmed, cut to the limit. Empty means "use the
 * default message", so this returns null for it.
 */
export function normalizeMaintenanceMessage(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  const text = raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAINTENANCE_MESSAGE_MAX)
    .trim();
  return text === '' ? null : text;
}

/** HTML text escaping: the message is always rendered as text, never as markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The standalone page served with 503 for an application in maintenance. */
export function renderMaintenancePage(message: string | null): string {
  const text = escapeHtml(message ?? DEFAULT_MAINTENANCE_MESSAGE);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Under maintenance</title>
<style>
:root { color-scheme: light dark; --bg: #fafafa; --fg: #171717; --muted: #525252; }
@media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #fafafa; --muted: #a3a3a3; } }
html, body { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; padding: 24px 16px; box-sizing: border-box; }
main { max-width: 480px; width: 100%; text-align: center; }
h1 { font-size: 20px; font-weight: 600; margin: 0 0 12px; }
p { font-size: 14px; line-height: 1.6; color: var(--muted); margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
</style>
</head>
<body>
<main>
<h1>Under maintenance</h1>
<p>${text}</p>
</main>
</body>
</html>
`;
}

/**
 * nginx config of the shared maintenance container. Every request gets 503
 * with Retry-After; the page is picked per application from the
 * `X-Aoox-App` header, which only the Traefik middleware of that application
 * sets (it overrides any value a client sends), and falls back to the default
 * page. The header value is an application uuid written by aoox.
 */
export function renderMaintenanceNginxConf(): string {
  return `server {
    listen 80 default_server;
    server_name _;
    root /www;
    server_tokens off;

    location / {
        return 503;
    }

    error_page 503 /__maintenance;

    location = /__maintenance {
        internal;
        try_files /pages/$http_x_aoox_app.html /pages/default.html =503;
        add_header Retry-After ${MAINTENANCE_RETRY_AFTER_SECONDS} always;
        add_header Cache-Control "no-store" always;
        add_header X-Robots-Tag "noindex" always;
        add_header X-Content-Type-Options "nosniff" always;
    }
}
`;
}
