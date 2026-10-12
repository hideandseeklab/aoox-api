import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApiTokenDto } from './create-api-token.dto';

const check = (body: object) =>
  validate(plainToInstance(CreateApiTokenDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('CreateApiTokenDto environments', () => {
  it('accepts environment names or nothing', async () => {
    expect(await check({ name: 't' })).toHaveLength(0);
    expect(
      await check({ name: 't', environments: ['development', 'qa-2'] }),
    ).toHaveLength(0);
  });

  it('rejects anything that is not a lowercase environment name', async () => {
    for (const bad of [
      ['Production'],
      ['a b'],
      [''],
      ['x'.repeat(33)],
      'dev',
    ]) {
      expect(await check({ name: 't', environments: bad })).not.toHaveLength(0);
    }
  });
});
