/** Socket.IO events for the `/terminal` namespace. Mirrored in the web app. */

// client -> server
export interface TerminalClientEvents {
  input: (data: string) => void;
  resize: (size: TerminalSize) => void;
}

// server -> client
export interface TerminalServerEvents {
  output: (data: string) => void;
  exit: (code: number) => void;
  error: (message: string) => void;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

/** Sent by the client in `socket.handshake.auth`. */
export interface TerminalHandshakeAuth {
  ticket?: string;
  cols?: number;
  rows?: number;
}

/** Roles allowed to open a host shell. */
export const TERMINAL_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

export interface TerminalTicketPayload {
  sub: string;
  role: string;
  scope: 'terminal';
  /** Unique id so a ticket can be consumed exactly once. */
  jti: string;
  /** Remote server to open the shell on; absent = the aoox host itself. */
  serverId?: string;
}
