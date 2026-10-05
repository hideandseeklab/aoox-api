/** Container name of the admin app attached to a database (`aoox-db-<slug>` is the database itself). */
export function companionContainerName(dbSlug: string): string {
  return `aoox-dbadmin-${dbSlug}`;
}
