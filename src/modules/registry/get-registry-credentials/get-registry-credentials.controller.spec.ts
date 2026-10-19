import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { GetRegistryCredentialsController } from './get-registry-credentials.controller';

describe('GetRegistryCredentialsController', () => {
  const handler = (name: string): unknown =>
    Object.getOwnPropertyDescriptor(
      GetRegistryCredentialsController.prototype,
      name,
    )?.value;

  it('reveal is a POST, so the audit interceptor records it (GETs are skipped)', () => {
    expect(
      Reflect.getMetadata(METHOD_METADATA, handler('reveal') as object),
    ).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(METHOD_METADATA, handler('get') as object)).toBe(
      RequestMethod.GET,
    );
  });

  it('is limited to owner and admin', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, GetRegistryCredentialsController),
    ).toEqual(['owner', 'admin']);
  });
});
