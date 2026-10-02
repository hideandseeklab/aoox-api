import { getMetadataArgsStorage } from 'typeorm';
import { getMetadataStorage } from 'class-validator';
import { CreateNotificationDto } from './create-notification/create-notification.dto';
import { CreateNotificationService } from './create-notification/create-notification.service';
import { Notification } from './notification.entity';
import { EVENT_TOGGLE, NotificationService } from './notification.service';

/**
 * Every `on_*` toggle has to exist at every step from the request body to the
 * channel list, or it can be switched in the UI and silently never stored
 * (what happened to `onDnsIssue`). This walks the entity's columns, so a
 * toggle added to the entity alone fails here.
 */
const toggleProps = getMetadataArgsStorage()
  .columns.filter(
    (c) =>
      c.target === Notification &&
      typeof c.options.name === 'string' &&
      c.options.name.startsWith('on_'),
  )
  .map((c) => c.propertyName);

describe('notification toggles', () => {
  it('finds the toggle columns', () => {
    expect(toggleProps.length).toBeGreaterThanOrEqual(12);
    expect(toggleProps).toEqual(
      expect.arrayContaining(['onServerDown', 'onHttpDown', 'onDnsIssue']),
    );
  });

  it('every toggle is accepted by the create DTO', () => {
    const validated = new Set(
      getMetadataStorage()
        .getTargetValidationMetadatas(
          CreateNotificationDto,
          '',
          false,
          false,
          undefined,
        )
        .map((m) => m.propertyName),
    );
    for (const prop of toggleProps) expect(validated).toContain(prop);
  });

  it('every toggle is wired to an event', () => {
    expect(Object.values(EVENT_TOGGLE).sort()).toEqual([...toggleProps].sort());
  });

  it('create stores every toggle the request sets, in both directions', async () => {
    let saved: Record<string, unknown> = {};
    const svc = new NotificationService(
      {
        create: (x: Record<string, unknown>) => x,
        save: (x: Record<string, unknown>) => {
          saved = x;
          return Promise.resolve({
            id: 'n',
            name: 'n',
            type: 'webhook',
            createdAt: new Date(),
            ...x,
          });
        },
      } as never,
      { getOrThrow: () => 'k' } as never,
    );
    const create = new CreateNotificationService(svc);
    for (const value of [true, false]) {
      const body: Record<string, unknown> = {
        name: 'n',
        type: 'webhook',
        url: 'http://x',
      };
      for (const prop of toggleProps) body[prop] = value;
      const dto = await create.execute(
        body as unknown as CreateNotificationDto,
      );
      for (const prop of toggleProps) {
        expect([prop, saved[prop]]).toEqual([prop, value]);
        expect([
          prop,
          (dto as unknown as Record<string, unknown>)[prop],
        ]).toEqual([prop, value]);
      }
    }
  });

  it('defaults: opt-in toggles off, the rest on', async () => {
    let saved: Record<string, unknown> = {};
    const svc = new NotificationService(
      {
        create: (x: Record<string, unknown>) => x,
        save: (x: Record<string, unknown>) => {
          saved = x;
          return Promise.resolve({ id: 'n', createdAt: new Date(), ...x });
        },
      } as never,
      { getOrThrow: () => 'k' } as never,
    );
    await new CreateNotificationService(svc).execute({
      name: 'n',
      type: 'webhook',
      url: 'http://x',
    });
    expect(saved.onDeploymentStarted).toBe(false);
    expect(saved.onAppError).toBe(false);
    expect(saved.onServerDown).toBe(true);
    expect(saved.onHttpDown).toBe(true);
  });
});
