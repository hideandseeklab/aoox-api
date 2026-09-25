import { createHmac, randomUUID } from 'crypto';
import { createTransport } from 'nodemailer';
import { NotificationConfig } from './notification.entity';

/** What every channel receives; each sender formats it for its platform. */
export interface NotificationMessage {
  /** Short headline, e.g. "Deployment succeeded: my-app". */
  title: string;
  /** Key/value details shown under the title. */
  fields: Array<[label: string, value: string]>;
  /** Optional link to the deployment in the web UI. */
  url?: string;
  /** Drives colors/emoji. */
  level: 'success' | 'failure' | 'info';
  /** Machine-readable payload for the generic webhook. */
  data: Record<string, unknown>;
}

const TIMEOUT_MS = 10_000;

/** Posts a message; rejects with a readable error on HTTP/network failure. */
export async function sendNotification(
  config: NotificationConfig,
  message: NotificationMessage,
): Promise<void> {
  if (config.type === 'email') return sendEmail(config, message);
  const { url, body } = requestFor(config, message);
  const raw = JSON.stringify(body);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.type === 'webhook'
          ? webhookHeaders(config, body as Record<string, unknown>, raw)
          : {}),
      },
      body: raw,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `${config.type}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(
      `${config.type}: HTTP ${res.status}${text ? ` — ${text}` : ''}`,
    );
  }
}

/** SMTP via nodemailer (https://nodemailer.com/). Timeouts keep a dead server from hanging a deploy. */
async function sendEmail(
  config: Extract<NotificationConfig, { type: 'email' }>,
  message: NotificationMessage,
): Promise<void> {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.username
      ? { user: config.username, pass: config.password ?? '' }
      : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  try {
    await transport.sendMail({
      from: config.from,
      to: config.to.join(', '),
      ...emailContent(message),
    });
  } catch (err) {
    throw new Error(
      `email: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    transport.close();
  }
}

/** Subject + text/html bodies (pure, unit-tested). */
export function emailContent(message: NotificationMessage): {
  subject: string;
  text: string;
  html: string;
} {
  const emoji = emojiFor(message.level);
  const text = [
    message.title,
    '',
    ...message.fields.map(([k, v]) => `${k}: ${v}`),
    ...(message.url ? ['', message.url] : []),
  ].join('\n');
  const rows = message.fields
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(k)}</td><td style="padding:2px 0"><code>${escapeHtml(v)}</code></td></tr>`,
    )
    .join('');
  const html =
    `<p style="font:15px sans-serif"><strong>${emoji} ${escapeHtml(message.title)}</strong></p>` +
    `<table style="font:13px monospace;border-collapse:collapse">${rows}</table>` +
    (message.url
      ? `<p style="font:13px sans-serif"><a href="${escapeHtml(message.url)}">${escapeHtml(message.url)}</a></p>`
      : '');
  return { subject: `[aoox] ${emoji} ${message.title}`, text, html };
}

function emojiFor(level: NotificationMessage['level']): string {
  return level === 'success' ? '✅' : level === 'failure' ? '❌' : 'ℹ️';
}

/** Pure mapping from config + message to the HTTP request (unit-tested). */
export function requestFor(
  config: Exclude<NotificationConfig, { type: 'email' }>,
  message: NotificationMessage,
): { url: string; body: unknown } {
  const emoji = emojiFor(message.level);
  switch (config.type) {
    case 'telegram': {
      // https://core.telegram.org/bots/api#sendmessage
      const lines = [
        `${emoji} <b>${escapeHtml(message.title)}</b>`,
        ...message.fields.map(
          ([k, v]) => `<b>${escapeHtml(k)}:</b> ${escapeHtml(v)}`,
        ),
      ];
      if (message.url) lines.push(escapeHtml(message.url));
      return {
        url: `https://api.telegram.org/bot${config.botToken}/sendMessage`,
        body: {
          chat_id: config.chatId,
          text: lines.join('\n'),
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        },
      };
    }
    case 'slack':
      // https://api.slack.com/messaging/webhooks (attachments for the color bar)
      return {
        url: config.webhookUrl,
        body: {
          text: `${emoji} ${message.title}`,
          attachments: [
            {
              color: colorHex(message.level),
              fields: message.fields.map(([title, value]) => ({
                title,
                value,
                short: value.length < 40,
              })),
              ...(message.url ? { title_link: message.url } : {}),
            },
          ],
        },
      };
    case 'discord':
      // https://discord.com/developers/docs/resources/webhook#execute-webhook
      return {
        url: config.webhookUrl,
        body: {
          embeds: [
            {
              title: `${emoji} ${message.title}`,
              color: parseInt(colorHex(message.level).slice(1), 16),
              fields: message.fields.map(([name, value]) => ({
                name,
                value,
                inline: value.length < 40,
              })),
              ...(message.url ? { url: message.url } : {}),
            },
          ],
        },
      };
    case 'webhook':
      return {
        url: config.url,
        body: {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          title: message.title,
          level: message.level,
          url: message.url ?? null,
          ...message.data,
        },
      };
  }
}

function colorHex(level: NotificationMessage['level']): string {
  return level === 'success'
    ? '#2eb886'
    : level === 'failure'
      ? '#e01e5a'
      : '#439fe0';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Delivery headers for the generic webhook. With a secret the receiver
 * verifies `sha256=HMAC-SHA256(secret, raw body)` — same scheme GitHub uses
 * (`X-Hub-Signature-256`), computed over the exact bytes sent.
 */
export function webhookHeaders(
  config: Extract<NotificationConfig, { type: 'webhook' }>,
  body: Record<string, unknown>,
  raw: string,
): Record<string, string> {
  const str = (v: unknown, fallback: string) =>
    typeof v === 'string' ? v : fallback;
  const headers: Record<string, string> = {
    'X-Aoox-Event': str(body.event, 'notification'),
    'X-Aoox-Delivery': str(body.id, ''),
  };
  if (config.secret) {
    headers['X-Aoox-Signature'] =
      `sha256=${createHmac('sha256', config.secret).update(raw).digest('hex')}`;
  }
  return headers;
}
