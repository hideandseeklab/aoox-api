import type { Application } from '../application.entity';

/** What `get-application` (and the PUT answer) reveal about the source: no credentials, ever. */
export interface SecretSourceView {
  connectionId: string;
  connectionName: string | null;
  projectId: string;
  environment: string;
  path: string;
  sync: boolean;
}

/** null when the application has no (complete) source. */
export function secretSourceView(
  app: Pick<
    Application,
    | 'secretConnectionId'
    | 'secretProjectId'
    | 'secretEnvironment'
    | 'secretPath'
    | 'secretSync'
  >,
  connectionName: string | null,
): SecretSourceView | null {
  if (!app.secretConnectionId || !app.secretProjectId) return null;
  return {
    connectionId: app.secretConnectionId,
    connectionName,
    projectId: app.secretProjectId,
    environment: app.secretEnvironment ?? '',
    path: app.secretPath || '/',
    sync: app.secretSync,
  };
}
