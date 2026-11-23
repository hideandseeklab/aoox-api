import { BadRequestException } from '@nestjs/common';
import { CreateApplicationService } from './create-application.service';

function build(check: jest.Mock) {
  const repo = {
    create: jest.fn((v: Record<string, unknown>) => v),
    save: jest.fn((v: Record<string, unknown>) =>
      Promise.resolve({ ...v, id: 'a1' }),
    ),
  };
  const service = new CreateApplicationService(
    { repo } as never,
    { findOwnedOrFail: jest.fn().mockResolvedValue({ id: 'p1' }) } as never,
    { check, replace: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, repo };
}

describe('CreateApplicationService env validation', () => {
  const dto = {
    projectId: 'p1',
    name: 'Web',
    sourceType: 'image',
    imageRef: 'nginx:latest',
    env: 'API=${{app.api.url}}',
  } as never;

  it('validates the env references even without variable set links', async () => {
    const check = jest.fn().mockResolvedValue(undefined);
    const { service, repo } = build(check);
    await service.execute('u1', dto);
    expect(check).toHaveBeenCalledWith(
      { kind: 'application', projectId: 'p1' },
      expect.objectContaining({ env: 'API=${{app.api.url}}' }),
      [],
      'u1',
    );
    expect(repo.save).toHaveBeenCalled();
  });

  it('answers 400 and saves nothing for a bad reference', async () => {
    const check = jest
      .fn()
      .mockRejectedValue(
        new BadRequestException('no application "api" in this project'),
      );
    const { service, repo } = build(check);
    await expect(service.execute('u1', dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.save).not.toHaveBeenCalled();
  });
});
