import { createHmac } from 'crypto';
import {
  emailContent,
  NotificationMessage,
  requestFor,
  sendNotification,
  webhookHeaders,
} from './notification-sender';

const message: NotificationMessage = {
  title: 'Deployment succeeded: my-app',
  level: 'success',
  fields: [
    ['Application', 'my-app'],
    ['Error', '<script>&'],
  ],
  url: 'https://panel.example.com/applications/1',
  data: { event: 'deployment.success', deploymentId: 'd1' },
};

describe('requestFor', () => {
  it('telegram: bot URL, HTML-escaped text, chat id', () => {
    const r = requestFor(
      { type: 'telegram', botToken: '123:abc', chatId: '-100' },
      message,
    );
    expect(r.url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(r.body).toMatchObject({ chat_id: '-100', parse_mode: 'HTML' });
    const text = (r.body as { text: string }).text;
    expect(text).toContain('<b>Deployment succeeded: my-app</b>');
    expect(text).toContain('&lt;script&gt;&amp;');
    expect(text).toContain('https://panel.example.com/applications/1');
  });

  it('slack: webhook with a colored attachment', () => {
    const r = requestFor(
      { type: 'slack', webhookUrl: 'https://hooks.slack.com/services/x' },
      message,
    );
    expect(r.url).toBe('https://hooks.slack.com/services/x');
    expect(r.body).toMatchObject({
      text: '✅ Deployment succeeded: my-app',
      attachments: [
        {
          color: '#2eb886',
          title_link: 'https://panel.example.com/applications/1',
          fields: expect.arrayContaining([
            { title: 'Application', value: 'my-app', short: true },
          ]) as unknown,
        },
      ],
    });
  });

  it('discord: embed with numeric color', () => {
    const r = requestFor(
      { type: 'discord', webhookUrl: 'https://discord.com/api/webhooks/x' },
      { ...message, level: 'failure' },
    );
    expect(r.body).toMatchObject({
      embeds: [
        {
          title: '❌ Deployment succeeded: my-app',
          color: 0xe01e5a,
          fields: expect.arrayContaining([
            { name: 'Application', value: 'my-app', inline: true },
          ]) as unknown,
        },
      ],
    });
  });

  it('webhook: flat JSON with the machine-readable data', () => {
    const r = requestFor(
      { type: 'webhook', url: 'http://ci.local/hook' },
      message,
    );
    expect(r.url).toBe('http://ci.local/hook');
    const { id, timestamp, ...rest } = r.body as Record<string, unknown>;
    expect(typeof id).toBe('string');
    expect(typeof timestamp).toBe('string');
    expect(rest).toEqual({
      title: 'Deployment succeeded: my-app',
      level: 'success',
      url: 'https://panel.example.com/applications/1',
      event: 'deployment.success',
      deploymentId: 'd1',
    });
  });
});

describe('sendNotification', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
  beforeAll(() => {
    global.fetch = fetchMock;
  });
  beforeEach(() => fetchMock.mockReset());

  it('POSTs JSON with a timeout signal', async () => {
    fetchMock.mockResolvedValue({ ok: true } as Response);
    await sendNotification(
      { type: 'webhook', url: 'http://ci.local/hook' },
      message,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ci.local/hook');
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toMatchObject({
      event: 'deployment.success',
    });
  });

  it('turns non-2xx and network errors into readable failures', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('chat not found'),
    } as unknown as Response);
    await expect(
      sendNotification(
        { type: 'telegram', botToken: 't', chatId: '1' },
        message,
      ),
    ).rejects.toThrow('telegram: HTTP 404 — chat not found');

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      sendNotification({ type: 'webhook', url: 'http://x' }, message),
    ).rejects.toThrow('webhook: ECONNREFUSED');
  });
});

describe('emailContent', () => {
  it('builds subject, plain text and escaped html', () => {
    const c = emailContent(message);
    expect(c.subject).toBe('[aoox] ✅ Deployment succeeded: my-app');
    expect(c.text).toContain('Application: my-app');
    expect(c.text).toContain('https://panel.example.com/applications/1');
    expect(c.html).toContain('&lt;script&gt;&amp;');
    expect(c.html).not.toContain('<script>');
  });

  it('webhook: signs the raw body with the secret (GitHub-style sha256=)', () => {
    const body = { id: 'd-1', event: 'deployment.success', x: 1 };
    const raw = JSON.stringify(body);
    const headers = webhookHeaders(
      { type: 'webhook', url: 'http://ci.local/hook', secret: 's3cret' },
      body,
      raw,
    );
    expect(headers['X-Aoox-Event']).toBe('deployment.success');
    expect(headers['X-Aoox-Delivery']).toBe('d-1');
    expect(headers['X-Aoox-Signature']).toBe(
      `sha256=${createHmac('sha256', 's3cret').update(raw).digest('hex')}`,
    );
    expect(
      webhookHeaders({ type: 'webhook', url: 'http://x' }, body, raw)[
        'X-Aoox-Signature'
      ],
    ).toBeUndefined();
  });
});
