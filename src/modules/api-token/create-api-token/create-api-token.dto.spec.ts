import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApiTokenDto } from './create-api-token.dto';

const check = (body: object) =>
  validate(plainToInstance(CreateApiTokenDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('CreateApiTokenDto variableScopes', () => {
  it('accepts set/environment scopes or nothing', async () => {
    expect(await check({ name: 't' })).toHaveLength(0);
    expect(
      await check({
        name: 't',
        variableScopes: ['backend/development', 'shared/*', '*/qa-2'],
      }),
    ).toHaveLength(0);
  });

  it('rejects anything else, including the removed environments field', async () => {
    for (const bad of [['Production'], ['dev'], ['a b/c'], [''], 'x/y']) {
      expect(await check({ name: 't', variableScopes: bad })).not.toHaveLength(
        0,
      );
    }
    expect(
      await check({ name: 't', environments: ['development'] }),
    ).not.toHaveLength(0);
  });
});
