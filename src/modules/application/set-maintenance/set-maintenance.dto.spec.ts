import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAINTENANCE_MESSAGE_MAX } from '../../maintenance-mode/maintenance-page';
import { SetMaintenanceDto } from './set-maintenance.dto';

describe('SetMaintenanceDto', () => {
  async function errorsFor(payload: Record<string, unknown>) {
    return validate(plainToInstance(SetMaintenanceDto, payload));
  }

  it('accepts a switch with or without a message', async () => {
    expect(await errorsFor({ enabled: true })).toHaveLength(0);
    expect(await errorsFor({ enabled: false, message: '' })).toHaveLength(0);
    expect(
      await errorsFor({ enabled: true, message: 'Back at 14:00' }),
    ).toHaveLength(0);
  });

  it('requires enabled to be a boolean', async () => {
    expect(await errorsFor({})).not.toHaveLength(0);
    expect(await errorsFor({ enabled: 'yes' })).not.toHaveLength(0);
  });

  it('limits the message length', async () => {
    const ok = 'x'.repeat(MAINTENANCE_MESSAGE_MAX);
    const tooLong = 'x'.repeat(MAINTENANCE_MESSAGE_MAX + 1);
    expect(await errorsFor({ enabled: true, message: ok })).toHaveLength(0);
    expect(
      await errorsFor({ enabled: true, message: tooLong }),
    ).not.toHaveLength(0);
  });

  it('rejects a non-string message', async () => {
    expect(await errorsFor({ enabled: true, message: 42 })).not.toHaveLength(0);
  });
});
