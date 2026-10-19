/**
 * Environment text (`KEY=VALUE` lines, build args) is secret material: a
 * project `viewer` may see that an application exists and how it is wired,
 * but not the values. Responses that carry the entity run it through
 * `hideEnv`, which blanks the fields for viewers and flags it so the web can
 * say why. Developers and up get the entity unchanged (`envHidden: false`).
 * `buildArgs` is only touched on rows that have it (applications, not stacks).
 */
export type WithEnvHidden<T> = Omit<T, 'env' | 'buildArgs'> & {
  env: string | null;
  envHidden: boolean;
} & (T extends { buildArgs: unknown } ? { buildArgs: string | null } : object);

export function hideEnv<T extends { env: string }>(
  row: T,
  canRead: boolean,
): WithEnvHidden<T> {
  if (canRead)
    return { ...row, envHidden: false } as unknown as WithEnvHidden<T>;
  const out: Record<string, unknown> = { ...row, env: null, envHidden: true };
  if ('buildArgs' in row) out.buildArgs = null;
  return out as unknown as WithEnvHidden<T>;
}
