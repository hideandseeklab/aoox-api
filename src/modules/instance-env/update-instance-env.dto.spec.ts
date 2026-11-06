import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateInstanceEnvDto } from './update-instance-env.dto';

const errors = (v: unknown) =>
  validateSync(plainToInstance(UpdateInstanceEnvDto, { proxyReadTimeout: v }));

describe('UpdateInstanceEnvDto proxyReadTimeout', () => {
  it.each(['300', '300s', '5m', '1h', ''])('accepts %p', (v) => {
    expect(errors(v)).toHaveLength(0);
  });
  it.each(['0', '86401', 'abc', '1.5', '5 m'])('rejects %p', (v) => {
    expect(errors(v)).toHaveLength(1);
  });
  it('is optional', () => {
    expect(
      validateSync(plainToInstance(UpdateInstanceEnvDto, {})),
    ).toHaveLength(0);
  });
});
