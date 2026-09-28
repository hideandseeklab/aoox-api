/** Socket.IO events for the `/console` namespace. Mirrored in the web app. */

// client -> server
export interface ConsoleClientEvents {
  input: (data: string) => void;
  resize: (size: ConsoleSize) => void;
}

// server -> client
export interface ConsoleServerEvents {
  output: (data: string) => void;
  exit: (code: number) => void;
  error: (message: string) => void;
}

export interface ConsoleSize {
  cols: number;
  rows: number;
}

/** Sent by the client in `socket.handshake.auth`. */
export interface ConsoleHandshakeAuth {
  ticket?: string;
  cols?: number;
  rows?: number;
}

export interface ConsoleTicketPayload {
  sub: string;
  scope: 'console';
  applicationId: string;
  /** Resolved and bound at ticket creation — the handshake never chooses it. */
  containerId: string;
  /** Remote server the container's daemon is on; absent = the aoox host. */
  serverId?: string;
  /** Unique id so a ticket can be consumed exactly once. */
  jti: string;
}
