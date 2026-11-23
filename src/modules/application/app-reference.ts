import { APP_FIELDS } from '../variable-set/env-text';
import { Application } from './application.entity';
import { containerNameFor } from './application.service';

export type AppField = (typeof APP_FIELDS)[number];

/** What `${{app.<appName>.<field>}}` is resolved for. */
export interface AppReferenceSource {
  /** Application env, or a compose stack's env (stacks run on the host daemon only). */
  kind: 'application' | 'compose';
  /** Missing for stacks (always plain containers). */
  deployMode?: 'container' | 'service' | null;
  /** `null`/missing = the aoox host daemon. */
  serverId?: string | null;
  /** The container is a plain container even when the application is in service mode (PR previews). */
  plainContainer?: boolean;
}

export function isAppField(f: string | undefined): f is AppField {
  return (APP_FIELDS as readonly string[]).includes(f ?? '');
}

/**
 * Why the source cannot reach `target` by its container name, or null when it
 * can. Plain containers join the `aoox` bridge of the daemon they run on;
 * swarm services join only the `aoox-swarm` overlay (host only). A name from
 * one network does not resolve on the other, and another daemon has its own
 * networks, so those combinations are refused rather than given an address
 * that would not connect.
 */
export function appReferenceProblem(
  source: AppReferenceSource,
  target: Pick<Application, 'appName' | 'deployMode' | 'serverId'>,
): string | null {
  const targetService = target.deployMode === 'service';
  const sourceService =
    source.kind === 'application' &&
    source.deployMode === 'service' &&
    !source.plainContainer;
  if (targetService !== sourceService) {
    return (
      `"${target.appName}" runs as ${targetService ? 'a Swarm service' : 'a plain container'} ` +
      `and this ${source.kind === 'compose' ? 'stack' : 'application'} runs ${sourceService ? 'as a Swarm service' : 'as a plain container'}: ` +
      `they are on different Docker networks (aoox-swarm vs aoox), so one cannot reach the other by name. ` +
      `Use the same deploy mode for both`
    );
  }
  if ((target.serverId ?? null) !== (source.serverId ?? null)) {
    return (
      `"${target.appName}" and this ${source.kind === 'compose' ? 'stack' : 'application'} run on different Docker daemons ` +
      `(the aoox host or a remote server), which do not share a network. ` +
      `Run both on the same server or use a domain`
    );
  }
  return null;
}

export function appReferenceFields(
  target: Application,
): Record<AppField, string> {
  const host = containerNameFor(target);
  const port = String(target.containerPort);
  return { host, port, url: `http://${host}:${port}` };
}

/**
 * The address other applications of the project use, for the application
 * page (not secret: a host and a port, visible to every project member).
 * `scope` says who can reach it: plain containers on the aoox host, Swarm
 * service applications (overlay network), or applications on the same remote
 * server.
 */
export interface InternalAddress {
  host: string;
  port: number;
  url: string;
  /** `${{app.<appName>.url}}`. */
  reference: string;
  scope: 'host' | 'service' | 'server';
}

export function internalAddressOf(app: Application): InternalAddress {
  const f = appReferenceFields(app);
  return {
    host: f.host,
    port: app.containerPort,
    url: f.url,
    reference: `\${{app.${app.appName}.url}}`,
    scope:
      app.deployMode === 'service'
        ? 'service'
        : app.serverId
          ? 'server'
          : 'host',
  };
}
