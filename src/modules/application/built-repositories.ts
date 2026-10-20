import type { Application } from './application.entity';

/** Project name as it appears in image repositories (`<slug>/<appName>`). */
export function slugPart(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  );
}

/**
 * Registry repositories aoox itself builds for an application: the deployment
 * repository and the pull-request preview one (`DeploymentRunnerService.buildImage`
 * names both `<project slug>/<appName>[-preview]`). Image-source applications
 * build nothing: what they pull belongs to someone else, so none is returned.
 * Applications whose project was renamed after a build used the old slug and
 * are not found here (their repositories are left alone, never guessed).
 */
export function builtRepositoriesFor(
  projectName: string,
  app: Pick<Application, 'appName' | 'sourceType'>,
): string[] {
  if (app.sourceType === 'image') return [];
  const base = `${slugPart(projectName)}/${app.appName}`;
  return [base, `${base}-preview`];
}
