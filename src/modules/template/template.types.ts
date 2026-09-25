/**
 * A built-in one-click stack. Shipped as TypeScript
 * so the catalog is typechecked, works offline and cannot be swapped for
 * attacker-controlled YAML at runtime.
 *
 * The compose file may use `${VAR}` interpolation for every declared
 * variable; values land in the stack's env (`.aoox.env`, passed with
 * `--env-file`). `generate` variables get a random value when the user
 * leaves them empty.
 */
export interface TemplateVariable {
  key: string;
  label: string;
  /** Default shown in the form; ignored when `generate` fills it. */
  default?: string;
  /** Random value when empty: url-safe alphabet without `$`/`{` (env + compose safe). */
  generate?: 'password' | 'secret';
  /** Free text shown under the field. */
  hint?: string;
  required?: boolean;
}

export interface TemplateService {
  /** Compose service name. */
  service: string;
  /** Container port Traefik forwards to. */
  port: number;
  label: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  /** Upstream version pinned in the compose image tags. */
  version: string;
  tags: string[];
  /** Project or docs link shown in the catalog. */
  links: { website?: string; docs?: string };
  /** Logo url (simple-icons CDN). */
  logo?: string;
  variables: TemplateVariable[];
  /** Services the user can put a domain on (first one is preselected). */
  services: TemplateService[];
  compose: string;
}
