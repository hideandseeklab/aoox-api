import type { ProjectRole } from '../project/project-member.entity';
import { ProjectRoles, setRoleFor } from './variable-set-access.service';

const roles = (entries: Array<[string, ProjectRole]>, platform = false) =>
  ({ platform, roles: new Map(entries) }) as ProjectRoles;

describe('setRoleFor (who sees a set, and as what)', () => {
  const sharedWithP1 = { sharedWithAll: false };
  const all = { sharedWithAll: true };

  it('an unscoped instance owner/admin sees every set, even one shared with nobody', () => {
    const ctx = { platform: true, roles: 'all' } as ProjectRoles;
    expect(setRoleFor(ctx, sharedWithP1, [])).toBe('platform');
    expect(setRoleFor(ctx, sharedWithP1, ['p9'])).toBe('platform');
  });

  it('a project-scoped token of an instance admin only sees sets shared with those projects', () => {
    const ctx = roles([['p1', 'admin']], true);
    expect(setRoleFor(ctx, sharedWithP1, ['p1'])).toBe('platform');
    expect(setRoleFor(ctx, sharedWithP1, ['p2'])).toBeNull();
    expect(setRoleFor(ctx, all, [])).toBe('platform');
  });

  it('members get their best role across the projects the set is shared with', () => {
    const ctx = roles([
      ['p1', 'viewer'],
      ['p2', 'developer'],
      ['p3', 'admin'],
    ]);
    expect(setRoleFor(ctx, sharedWithP1, ['p1'])).toBe('viewer');
    expect(setRoleFor(ctx, sharedWithP1, ['p1', 'p2'])).toBe('developer');
    expect(setRoleFor(ctx, sharedWithP1, ['p1', 'p3'])).toBe('admin');
    expect(setRoleFor(ctx, all, [])).toBe('admin');
  });

  it('outsiders (no project the set is shared with) do not see it: 404', () => {
    expect(
      setRoleFor(roles([['p1', 'admin']]), sharedWithP1, ['p2']),
    ).toBeNull();
    expect(setRoleFor(roles([]), all, [])).toBeNull();
  });
});
