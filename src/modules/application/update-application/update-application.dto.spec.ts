import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateApplicationDto } from './update-application.dto';

/**
 * The web form's Image/Git sections are conditionally mounted, so saving an
 * app's settings can submit an empty string for the field that belongs to
 * the *other* source type (e.g. `imageRef: ""` for a git app). `@IsOptional`
 * only skips `null`/`undefined`, not `""`, so these fields need an explicit
 * `@ValidateIf` to accept the empty string too.
 */
describe('UpdateApplicationDto', () => {
  async function errorsFor(payload: Record<string, unknown>) {
    const dto = plainToInstance(UpdateApplicationDto, payload);
    return validate(dto);
  }

  it('accepts an empty imageRef (git app untouched by the Image field)', async () => {
    const errors = await errorsFor({ imageRef: '' });
    expect(errors).toHaveLength(0);
  });

  it('accepts an empty gitUrl (image app untouched by the Git field)', async () => {
    const errors = await errorsFor({ gitUrl: '' });
    expect(errors).toHaveLength(0);
  });

  it('accepts empty gitBranch/dockerfilePath/staticOutputDir', async () => {
    const errors = await errorsFor({
      gitBranch: '',
      dockerfilePath: '',
      staticOutputDir: '',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts an empty previewDomain alongside its existing null handling', async () => {
    const errors = await errorsFor({ previewDomain: '' });
    expect(errors).toHaveLength(0);
  });

  it('still rejects an invalid, non-empty imageRef', async () => {
    const errors = await errorsFor({ imageRef: 'Not A Valid Ref!!' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('imageRef');
  });

  it('still rejects an invalid, non-empty gitUrl', async () => {
    const errors = await errorsFor({ gitUrl: 'not-a-url' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('gitUrl');
  });

  it('accepts a valid imageRef', async () => {
    const errors = await errorsFor({ imageRef: 'ghcr.io/org/app:1.2' });
    expect(errors).toHaveLength(0);
  });
});
