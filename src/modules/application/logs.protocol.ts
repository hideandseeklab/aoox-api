/** Socket.IO events for the `/logs` namespace. Mirrored in the web app. */

// client -> server
export interface LogsClientEvents {
  /** Stream a deployment: existing text first, then live chunks until it ends. */
  'subscribe:deployment': (deploymentId: string) => void;
  /**
   * Follow the container's stdout/stderr. A bare number is the tail length
   * (always following). `{follow: false}` sends the tail and then
   * `container:end`, like `docker logs` without `-f` (used by the CLI).
   */
  'subscribe:container': (
    tail: number | { tail?: number; follow?: boolean },
  ) => void;
  unsubscribe: () => void;
}

/** Mirrors `DeploymentTrigger` in deployment.entity.ts. */
export type LogsDeploymentTrigger = 'manual' | 'webhook' | 'auto-update';

// server -> client
export interface LogsServerEvents {
  /** `snapshot: true` carries the full text so far; otherwise `chunk` is appended. */
  'deployment:log': (payload: {
    deploymentId: string;
    chunk: string;
    snapshot?: boolean;
  }) => void;
  'deployment:status': (payload: {
    deploymentId: string;
    status: string;
    /** ISO time the status was announced; absent on the snapshot sent when subscribing. */
    at?: string;
  }) => void;
  /** Broadcast to every socket ticketed for the application, not just one
   * already subscribed to a deployment â€” lets an open page notice a
   * webhook/auto-update/other-user deploy without a manual refresh. */
  'deployment:created': (payload: {
    id: string;
    trigger: LogsDeploymentTrigger;
    commitSha: string | null;
    commitMessage: string | null;
    triggeredBy: string | null;
  }) => void;
  'container:log': (chunk: string) => void;
  'container:end': () => void;
  error: (message: string) => void;
}

export interface LogsHandshakeAuth {
  ticket?: string;
}

/** What a `/logs` or `/console` ticket is scoped to. Absent = `application`. */
export type TicketOwnerKind = 'application' | 'database' | 'compose';

/**
 * Ticket payload. An application ticket is scoped to one application (the
 * gateway resolves its container itself, so a redeploy is followed). A
 * `database` or `compose` ticket instead binds the already-resolved
 * `containerId` (host daemon) — the handshake never chooses it — and only
 * supports `subscribe:container`.
 */
export interface LogsTicketPayload {
  sub: string;
  scope: 'logs';
  ownerKind?: TicketOwnerKind;
  applicationId?: string;
  databaseId?: string;
  composeAppId?: string;
  /** Required for `database` and `compose`. */
  containerId?: string;
  /** Compose only: the service the container belongs to. */
  service?: string;
  jti: string;
}
