import { BackupSchedulerService } from './backup-scheduler.service';

describe('BackupSchedulerService.isValidCron', () => {
  it('accepts standard 5-field expressions', () => {
    expect(BackupSchedulerService.isValidCron('0 2 * * *')).toBe(true);
    expect(BackupSchedulerService.isValidCron('*/15 * * * 1-5')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(BackupSchedulerService.isValidCron('every day')).toBe(false);
    expect(BackupSchedulerService.isValidCron('99 99 * * *')).toBe(false);
  });
});
