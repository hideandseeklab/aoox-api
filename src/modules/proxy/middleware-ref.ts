/**
 * A Traefik middleware from the operator dynamic config files, as a domain
 * stores it and as it appears in router labels: lowercase name + `@file`.
 * Anything else (another provider, `,`, spaces) never reaches a label value.
 */
export const MIDDLEWARE_REF = /^[a-z0-9][a-z0-9-]{0,62}@file$/;
