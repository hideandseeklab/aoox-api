import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApplicationDto } from './create-application.dto';

/**
 * The web form's Image/Git/Dockerfile/Static sections are conditionally
 * mounted per `sourceType`/`buildType`, so creating an app with (say)
 * `buildType: 'nixpacks'` still submits `dockerfilePath: ""` (the Dockerfile
 * field for a different build type). `@IsOptional` only skips
 * `null`/`undefined`, not `""`, so these fields need an explicit
 * `@ValidateIf` to accept the empty string too — same bug as
 * `update-application.dto.ts`, here in the create path.
 */
describe('CreateApplicationDto', () => {
  const base = {
    projectId: '123e4567-e89b-12d3-a456-426614174000',
    name: 'app',
    gitUrl: 'https://github.com/org/repo.git',
  };

  async function errorsFor(payload: Record<string, unknown>) {
    const dto = plainToInstance(CreateApplicationDto, { ...base, ...payload });
    return validate(dto);
  }

  it('accepts an empty dockerfilePath for a nixpacks build', async () => {
    const errors = await errorsFor({
      buildType: 'nixpacks',
      dockerfilePath: '',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts an empty dockerfilePath for a railpack build', async () => {
    const errors = await errorsFor({
      buildType: 'railpack',
      dockerfilePath: '',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts empty staticOutputDir/staticBuildCommand for a static build', async () => {
    const errors = await errorsFor({
      buildType: 'static',
      staticOutputDir: '',
      staticBuildCommand: '',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts an empty gitBranch, previewDomain, and healthcheckPath', async () => {
    const errors = await errorsFor({
      gitBranch: '',
      previewDomain: '',
      healthcheckPath: '',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts an empty gitUrl for an image-sourced app', async () => {
    const errors = await errorsFor({
      gitUrl: '',
      sourceType: 'image',
      imageRef: 'ghcr.io/org/app:1.2',
    });
    expect(errors).toHaveLength(0);
  });

  it('still rejects an invalid, non-empty dockerfilePath', async () => {
    const errors = await errorsFor({ dockerfilePath: 'has space' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('dockerfilePath');
  });

  it('still rejects an invalid, non-empty previewDomain', async () => {
    const errors = await errorsFor({ previewDomain: 'not a domain' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('previewDomain');
  });

  it('still requires gitUrl for the default git source', async () => {
    const errors = await errorsFor({ gitUrl: '' });
    expect(errors.some((e) => e.property === 'gitUrl')).toBe(true);
  });

  it('still requires imageRef for the image source', async () => {
    const errors = await errorsFor({
      gitUrl: '',
      sourceType: 'image',
      imageRef: '',
    });
    expect(errors.some((e) => e.property === 'imageRef')).toBe(true);
  });
});
