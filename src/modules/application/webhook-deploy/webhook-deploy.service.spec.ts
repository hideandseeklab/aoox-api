import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { encryptSecret } from '../../docker/secret.util';
import { Test } from '@nestjs/testing';
import { ApplicationService } from '../application.service';
import { DeployApplicationService } from '../deploy-application/deploy-application.service';
import { PreviewService } from '../preview.service';
import { WebhookDeployService } from './webhook-deploy.service';

describe('WebhookDeployService', () => {
  const app = {
    id: 'a1',
    appName: 'web',
    gitBranch: 'main',
    webhookToken: 'tok-123456789012345678',
  };
  const qb = {
    addSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
  };
  const deploys = { queue: jest.fn() };
  const previews = {
    upsert: jest.fn(),
    destroy: jest.fn(),
    findByPr: jest.fn(),
  };
  let service: WebhookDeployService;
  let configValues: Record<string, string>;

  beforeEach(async () => {
    jest.clearAllMocks();
    qb.getOne.mockResolvedValue(app);
    deploys.queue.mockResolvedValue({ id: 'd1' });
    configValues = {};
    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookDeployService,
        {
          provide: ApplicationService,
          useValue: { repo: { createQueryBuilder: () => qb } },
        },
        { provide: DeployApplicationService, useValue: deploys },
        { provide: PreviewService, useValue: previews },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => 'enc-key',
            get: (key: string) => configValues[key],
          },
        },
      ],
    }).compile();
    service = moduleRef.get(WebhookDeployService);
  });

  it('404s on an unknown token', async () => {
    qb.getOne.mockResolvedValue(null);
    await expect(service.execute('nope', {}, 'push')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('queues a deploy for a push to the configured branch (GitHub and GitLab shapes)', async () => {
    await expect(
      service.execute(app.webhookToken, { ref: 'refs/heads/main' }, 'push'),
    ).resolves.toEqual({ result: 'queued', deploymentId: 'd1' });
    await expect(
      service.execute(
        app.webhookToken,
        { object_kind: 'push', ref: 'refs/heads/main' },
        'Push Hook',
      ),
    ).resolves.toEqual({ result: 'queued', deploymentId: 'd1' });
    expect(deploys.queue).toHaveBeenCalledTimes(2);
  });

  it('requires a valid GitHub signature or GitLab token once a secret is set', async () => {
    const secret = 's3cr3t';
    qb.getOne.mockResolvedValue({
      ...app,
      webhookSecretEncrypted: encryptSecret(secret, 'enc-key'),
    });
    const body = Buffer.from('{"ref":"refs/heads/main"}');
    const payload = { ref: 'refs/heads/main' };
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

    // No proof at all, wrong signature, wrong token -> 401, nothing queued.
    for (const headers of [
      {},
      { hubSignature256: 'sha256=00' },
      { gitlabToken: 'nope' },
    ]) {
      await expect(
        service.execute(app.webhookToken, payload, 'push', {
          rawBody: body,
          headers,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    expect(deploys.queue).not.toHaveBeenCalled();

    await expect(
      service.execute(app.webhookToken, payload, 'push', {
        rawBody: body,
        headers: { hubSignature256: sig },
      }),
    ).resolves.toMatchObject({ result: 'queued' });
    await expect(
      service.execute(app.webhookToken, payload, 'push', {
        rawBody: body,
        headers: { gitlabToken: secret },
      }),
    ).resolves.toMatchObject({ result: 'queued' });
  });

  it('ignores other branches, non-push events and branch deletions', async () => {
    // `zen` is GitHub's ping payload: not in PushPayload, hence the cast.
    for (const [payload, event] of [
      [{ ref: 'refs/heads/develop' }, 'push'],
      [{ zen: 'x' } as unknown as { ref?: string }, 'ping'],
      [{ ref: 'refs/heads/main', deleted: true }, 'push'],
    ] as const) {
      const r = await service.execute(app.webhookToken, payload, event);
      expect(r.result).toBe('ignored');
    }
    expect(deploys.queue).not.toHaveBeenCalled();
  });

  it('reports busy instead of failing when a deployment is running', async () => {
    deploys.queue.mockRejectedValueOnce(
      new ConflictException('A deployment is already in progress'),
    );
    const r = await service.execute(
      app.webhookToken,
      { ref: 'refs/heads/main' },
      'push',
    );
    expect(r).toEqual({
      result: 'busy',
      reason: 'A deployment is already in progress',
    });
  });

  describe('pull requests', () => {
    const ghPr = (action: string, fork = false) => ({
      action,
      number: 7,
      pull_request: {
        title: 'Add thing',
        html_url: 'https://github.com/o/r/pull/7',
        head: {
          ref: 'feature/x',
          sha: 'abc123',
          repo: { full_name: fork ? 'someone/r' : 'o/r' },
        },
        base: { repo: { full_name: 'o/r' } },
      },
    });

    it('ignores PR events unless previews are enabled', async () => {
      const r = await service.execute(
        app.webhookToken,
        ghPr('opened'),
        'pull_request',
      );
      expect(r).toEqual({ result: 'ignored', reason: 'previews disabled' });
      expect(previews.upsert).not.toHaveBeenCalled();
    });

    it('builds on opened/synchronize, never from forks, and respects the cap', async () => {
      qb.getOne.mockResolvedValue({ ...app, previewsEnabled: true });
      previews.upsert.mockResolvedValue({ id: 'p1' });
      await expect(
        service.execute(app.webhookToken, ghPr('opened'), 'pull_request'),
      ).resolves.toEqual({ result: 'preview', previewId: 'p1' });
      expect(previews.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a1' }),
        expect.objectContaining({
          number: 7,
          branch: 'feature/x',
          sha: 'abc123',
        }),
      );
      await expect(
        service.execute(app.webhookToken, ghPr('synchronize'), 'pull_request'),
      ).resolves.toEqual({ result: 'preview', previewId: 'p1' });

      previews.upsert.mockClear();
      await expect(
        service.execute(app.webhookToken, ghPr('opened', true), 'pull_request'),
      ).resolves.toEqual({ result: 'ignored', reason: 'fork' });
      expect(previews.upsert).not.toHaveBeenCalled();

      previews.upsert.mockResolvedValueOnce(null);
      await expect(
        service.execute(app.webhookToken, ghPr('reopened'), 'pull_request'),
      ).resolves.toEqual({ result: 'ignored', reason: 'preview limit' });
      expect(deploys.queue).not.toHaveBeenCalled();
    });

    it('tears the preview down on close, and handles GitLab merge requests', async () => {
      qb.getOne.mockResolvedValue({ ...app, previewsEnabled: true });
      previews.findByPr.mockResolvedValueOnce({ id: 'p1' });
      await expect(
        service.execute(app.webhookToken, ghPr('closed'), 'pull_request'),
      ).resolves.toEqual({ result: 'preview-closed', previewId: 'p1' });
      expect(previews.destroy).toHaveBeenCalled();

      previews.upsert.mockResolvedValue({ id: 'p2' });
      await expect(
        service.execute(
          app.webhookToken,
          {
            object_kind: 'merge_request',
            object_attributes: {
              action: 'open',
              iid: 3,
              title: 'MR',
              source_branch: 'mr-branch',
              last_commit: { id: 'def' },
              source_project_id: 1,
              target_project_id: 1,
            },
          },
          'Merge Request Hook',
        ),
      ).resolves.toEqual({ result: 'preview', previewId: 'p2' });
      expect(previews.upsert).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ number: 3, branch: 'mr-branch' }),
      );
    });
  });

  describe('optional GitHub IP check (WEBHOOK_VERIFY_GITHUB_IP)', () => {
    const secret = 's3cr3t';
    const body = Buffer.from('{"ref":"refs/heads/main"}');
    const payload = { ref: 'refs/heads/main' };
    const sig = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    let fetchMock: jest.Mock;

    beforeEach(() => {
      qb.getOne.mockResolvedValue({
        ...app,
        webhookSecretEncrypted: encryptSecret(secret, 'enc-key'),
      });
      fetchMock = jest.fn();
      global.fetch = fetchMock;
    });

    // Deliberately runs first in this describe block: githubHookRanges()
    // caches for an hour, so this is the one place a failed lookup can be
    // observed before a later test warms the cache with a real response.
    it("fails open (allows the delivery) when GitHub's range list cannot be fetched", async () => {
      configValues.WEBHOOK_VERIFY_GITHUB_IP = 'true';
      fetchMock.mockRejectedValue(new Error('network down'));
      await expect(
        service.execute(app.webhookToken, payload, 'push', {
          rawBody: body,
          headers: { hubSignature256: sig },
          sourceIp: '203.0.113.9', // not GitHub's, but we can't check right now
          isGithub: true,
        }),
      ).resolves.toMatchObject({ result: 'queued' });
    });

    it("accepts a source IP inside GitHub's published ranges", async () => {
      configValues.WEBHOOK_VERIFY_GITHUB_IP = 'true';
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hooks: ['192.30.252.0/22'] }),
      });
      await expect(
        service.execute(app.webhookToken, payload, 'push', {
          rawBody: body,
          headers: { hubSignature256: sig },
          sourceIp: '192.30.252.10',
          isGithub: true,
        }),
      ).resolves.toMatchObject({ result: 'queued' });
    });

    it('rejects a signature-valid delivery from outside the published ranges', async () => {
      configValues.WEBHOOK_VERIFY_GITHUB_IP = 'true';
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hooks: ['192.30.252.0/22'] }),
      });
      await expect(
        service.execute(app.webhookToken, payload, 'push', {
          rawBody: body,
          headers: { hubSignature256: sig },
          sourceIp: '203.0.113.9',
          isGithub: true,
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(deploys.queue).not.toHaveBeenCalled();
    });

    it('never checks the IP for a GitLab delivery, even with the flag on', async () => {
      configValues.WEBHOOK_VERIFY_GITHUB_IP = 'true';
      await expect(
        service.execute(app.webhookToken, payload, 'push', {
          rawBody: body,
          headers: { gitlabToken: secret },
          sourceIp: '203.0.113.9',
          isGithub: false,
        }),
      ).resolves.toMatchObject({ result: 'queued' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is off by default: a mismatched IP does not matter unless the flag is set', async () => {
      await expect(
        service.execute(app.webhookToken, payload, 'push', {
          rawBody: body,
          headers: { hubSignature256: sig },
          sourceIp: '203.0.113.9',
          isGithub: true,
        }),
      ).resolves.toMatchObject({ result: 'queued' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
