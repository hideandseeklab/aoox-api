/** Socket.IO events for the `/logs` namespace. Mirrored in the web app. */

// client -> server
export interface LogsClientEvents {
  /** Stream a deployment: existing text first, then live chunks until it ends. */
  'subscribe:deployment': (deploymentId: string) => void;
  /** Follow the application container's stdout/stderr. */
  'subscribe:container': (tail: number) => void;
  unsubscribe: () => void;
}

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
