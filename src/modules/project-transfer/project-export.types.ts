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
  /** Monorepo subfolder (absent in files from before it existed). */
  rootDirectory?: string | null;
  watchRootOnly?: boolean;
  buildType: 'dockerfile' | 'nixpacks' | 'railpack' | 'static';
  staticBuildCommand: string | null;
  staticOutputDir: string;
  staticSpa: boolean;
  containerPort: number;
  hostPort: number | null;
  env: string;
  /** Name of the linked project environment; absent in older files (production). */
  environment?: string | null;
  buildArgs: string;
  healthcheckPath: string | null;
  ignoreErrorLogs?: boolean;
  /** CPU / memory alert rules (config only, no state); absent in older files. */
  resourceAlerts?: ExportedResourceAlerts | null;
  /** HTTP monitor settings only (no state or history); absent in older files. */
  httpMonitor?: {
    enabled: boolean;
    path: string;
    intervalMinutes: number;
    timeoutSeconds: number;
    expectedCodes: string;
    failureThreshold: number;
    useInternal: boolean;
  } | null;
  deploymentKeep: number;
  backupCron: string | null;
  backupKeep: number;
  cpuMillicores: number | null;
  memoryMb: number | null;
  previewsEnabled: boolean;
  previewDomain: string | null;
  /** One wildcard DNS-01 certificate for previews. Optional in older files. */
  previewWildcardCert?: boolean;
  /** External secret source: the connection by NAME and where to read; never credentials or values. Optional in older files. */
  secretSource?: {
    connection: string;
    projectId: string;
    environment: string;
    path: string;
    sync: boolean;
  } | null;
  references: {
    gitCredential: string | null;
    imageRegistry: string | null;
    backupDestination: string | null;
    server: string | null;
  };
  domains: Array<{
    host: string;
    https: boolean;
    /** ACME mode; optional in older files (default http). */
    certMode?: 'http' | 'dns' | 'dns-wildcard';
    /** DNS provider connection by NAME (never a token); optional in older files. */
    dns?: { connection: string; proxied: boolean } | null;
  }>;
  mounts: ExportedMount[];
  jobs: ExportedJob[];
}

export interface ExportedDatabase {
  name: string;
  slug: string;
  engine: 'postgres' | 'mysql' | 'mariadb' | 'redis' | 'valkey' | 'mongodb';
  variant: 'pgvector' | 'postgis' | 'timescaledb' | null;
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
  /** CPU / memory alert rules (config only, no state); absent in older files. */
  resourceAlerts?: ExportedResourceAlerts | null;
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
  /** Name of the linked project environment; absent in older files (production). */
  environment?: string | null;
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
  project: {
    name: string;
    description: string | null;
    /** Files from before environments: the shared env, imported into production. */
    env?: string;
  };
  /**
   * Project environments. Variables only with `includesSecrets` (like
   * database passwords); absent in older files.
   */
  environments?: Array<{
    name: string;
    protected: boolean;
    variables?: string;
    /** Names flagged secret / explicitly not secret (names only, always exported). */
    secretKeys?: string[];
    plainKeys?: string[];
  }>;
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

export interface ExportedResourceAlertRule {
  enabled: boolean;
  thresholdPercent: number;
  durationMinutes: number;
}

export interface ExportedResourceAlerts {
  cpu: ExportedResourceAlertRule;
  memory: ExportedResourceAlertRule;
}
