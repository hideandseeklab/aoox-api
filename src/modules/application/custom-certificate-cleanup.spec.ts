import { isWriteRequest, runWithRequestContext } from '../auth/request-context';
import { DeleteApplicationService } from './delete-application/delete-application.service';
import { DeleteDomainController } from './delete-domain/delete-domain.controller';

describe('certificate files are dropped when their last domain goes', () => {
  it('deleting a domain that used a certificate syncs that app daemon afterwards', async () => {
    const order: string[] = [];
    const domain = { id: 'd1', applicationId: 'app1', certificateId: 'c1' };
    const controller = new DeleteDomainController(
      {
        findOwnedOrFail: jest
          .fn()
          .mockResolvedValue({ id: 'app1', serverId: 'srv1' }),
        domains: {
          findOne: jest.fn().mockResolvedValue(domain),
          remove: jest.fn(() => {
            order.push('remove');
            return Promise.resolve();
          }),
        },
      } as never,
      {
        applyRuntimeConfig: jest.fn(() => {
          order.push('apply');
          return Promise.resolve();
        }),
      } as never,
      {
        syncServer: jest.fn(() => {
          order.push('sync');
          return Promise.resolve();
        }),
      } as never,
    );
    await controller.remove({ sub: 'u' } as never, {
      id: 'app1',
      domainId: 'd1',
    });
    expect(order).toEqual(['remove', 'apply', 'sync']);
  });

  it('a domain without a certificate costs no sync, and a failed cleanup does not fail the delete', async () => {
    const sync = jest.fn().mockRejectedValue(new Error('ssh down'));
    const make = (certificateId: string | null) =>
      new DeleteDomainController(
        {
          findOwnedOrFail: jest
            .fn()
            .mockResolvedValue({ id: 'app1', serverId: null }),
          domains: {
            findOne: jest.fn().mockResolvedValue({ id: 'd1', certificateId }),
            remove: jest.fn().mockResolvedValue(undefined),
          },
        } as never,
        { applyRuntimeConfig: jest.fn().mockResolvedValue(undefined) } as never,
        { syncServer: sync } as never,
      );
    await make(null).remove({ sub: 'u' } as never, {
      id: 'app1',
      domainId: 'd1',
    });
    expect(sync).not.toHaveBeenCalled();
    await expect(
      make('c1').remove({ sub: 'u' } as never, { id: 'app1', domainId: 'd1' }),
    ).resolves.toBeUndefined();
    expect(sync).toHaveBeenCalledWith(null);
  });

  function deleteApp(certDomains: number, syncError?: Error) {
    const sync = jest.fn(() =>
      syncError ? Promise.reject(syncError) : Promise.resolve(),
    );
    const app = {
      id: 'a1',
      appName: 'web',
      serverId: 'srv1',
      deployMode: 'container',
    };
    const svc = new DeleteApplicationService(
      {
        findOwnedOrFail: jest.fn().mockResolvedValue(app),
        repo: { remove: jest.fn().mockResolvedValue(undefined) },
        domains: { count: jest.fn().mockResolvedValue(certDomains) },
      } as never,
      {
        forServer: jest.fn().mockResolvedValue({
          findContainerByName: jest.fn().mockResolvedValue(null),
          engine: {},
        }),
      } as never,
      { remove: jest.fn() } as never,
      { forget: jest.fn() } as never,
      { destroyAll: jest.fn().mockResolvedValue(undefined) } as never,
      { syncServer: sync } as never,
    );
    return { svc, sync };
  }

  it('deleting an application whose domains used a certificate syncs its server afterwards', async () => {
    const { svc, sync } = deleteApp(2);
    await svc.execute('u', 'a1');
    expect(sync).toHaveBeenCalledWith('srv1');
  });

  it('deleting an application without certificates does not sync; a failing sync does not fail the delete', async () => {
    const none = deleteApp(0);
    await none.svc.execute('u', 'a1');
    expect(none.sync).not.toHaveBeenCalled();

    const failing = deleteApp(1, new Error('down'));
    await expect(failing.svc.execute('u', 'a1')).resolves.toBeUndefined();
  });
});

describe('viewers cannot assign certificates', () => {
  it('PATCH on a domain is a write request, so a viewer is refused by the project access check', () => {
    const write = runWithRequestContext(
      { method: 'PATCH', path: '/applications/a/domains/d' },
      () => isWriteRequest(),
    );
    expect(write).toBe(true);
    const read = runWithRequestContext(
      { method: 'GET', path: '/certificates' },
      () => isWriteRequest(),
    );
    expect(read).toBe(false);
  });
});
