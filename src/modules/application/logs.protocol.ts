/** Socket.IO events for the `/logs` namespace. Mirrored in the web app. */

// client -> server
export interface LogsClientEvents {
  /** Stream a deployment: existing text first, then live chunks until it ends. */
  'subscribe:deployment': (deploymentId: string) => void;
  /** Follow the application container's stdout/stderr. */
  'subscribe:container': (tail: number) => void;
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
  }) => void;
  /** Broadcast to every socket ticketed for the application, not just one
   * already subscribed to a deployment — lets an open page notice a
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

/** Ticket payload: scoped to one application. */
export interface LogsTicketPayload {
  sub: string;
  scope: 'logs';
  applicationId: string;
  jti: string;
}
