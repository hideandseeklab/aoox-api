/**
 * Portable description of a project — aoox's own format. Ids are never exported: references to
 * platform objects (registries, git credentials, backup destinations,
 * servers) travel by **name** and are matched on import, unmatched ones
 * become warnings. Secrets that only make sense together with data
 * (database passwords) are included only with `includeSecrets`; webhook
 * tokens/secrets are regenerated on import.
 */
export const EXPORT_FORMAT = 'aoox-project';
export const EXPORT_VERSION = 1;

export interface ExportedMount {
  type: 'volume' | 'bind' | 'file';
  name: string | null;
  hostPath: string | null;
  content: string | null;
  containerPath: string;
  readOnly: boolean;
}

export interface ExportedJob {
  name: string;
  cron: string | null;
  command: string;
  target: 'container' | 'run';
  enabled: boolean;
  timeoutSeconds: number;
  /** Compose jobs only. */
  service?: string | null;
}

export interface ExportedApplication {
  name: string;
  appName: string;
  sourceType: 'git' | 'image';
  gitUrl: string | null;
  gitBranch: string;
  imageRef: string | null;
  dockerfilePath: string;
  buildType: 'dockerfile' | 'nixpacks' | 'railpack' | 'static';
  staticBuildCommand: string | null;
  staticOutputDir: string;
  staticSpa: boolean;
  containerPort: number;
  hostPort: number | null;
  env: string;
  buildArgs: string;
  healthcheckPath: string | null;
  deploymentKeep: number;
  backupCron: string | null;
  backupKeep: number;
  cpuMillicores: number | null;
  memoryMb: number | null;
  previewsEnabled: boolean;
  previewDomain: string | null;
  references: {
    gitCredential: string | null;
    imageRegistry: string | null;
    backupDestination: string | null;
    server: string | null;
  };
  domains: Array<{ host: string; https: boolean }>;
  mounts: ExportedMount[];
  jobs: ExportedJob[];
}

export interface ExportedDatabase {
  name: string;
  slug: string;
  engine: 'postgres' | 'mysql' | 'mariadb' | 'redis';
  imageTag: string;
  databaseName: string;
  username: string;
  /** Only with `includeSecrets`; otherwise null and a new password is generated on import. */
  password: string | null;
  hostPort: number | null;
  cpuMillicores: number | null;
  memoryMb: number | null;
  backupCron: string | null;
  backupKeep: number;
  backupAllDatabases: boolean;
  references: { backupDestination: string | null };
  mounts: ExportedMount[];
  jobs: ExportedJob[];
}

export interface ExportedComposeApp {
  name: string;
  slug: string;
  source: 'git' | 'template';
  templateId: string | null;
  composeContent: string | null;
  gitUrl: string | null;
  gitBranch: string;
  composePath: string;
  env: string;
  serviceDomains: Array<{
    service: string;
    port: number;
    host: string;
    https: boolean;
  }>;
  /** Optional: files from before this field existed have none. */
  servicePorts?: Array<{ service: string; port: number; hostPort: number }>;
  references: { gitCredential: string | null };
  jobs: ExportedJob[];
}

export interface ProjectExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  includesSecrets: boolean;
  project: { name: string; description: string | null; env: string };
  applications: ExportedApplication[];
  databases: ExportedDatabase[];
  composeApps: ExportedComposeApp[];
}

export interface ImportReport {
  projectId: string;
  created: {
    applications: number;
    databases: number;
    composeApps: number;
    domains: number;
    mounts: number;
    jobs: number;
  };
  /** Renamed slugs, unresolved references, skipped items. */
  warnings: string[];
}
