import { hideEnv } from './env-visibility';

describe('hideEnv', () => {
  const row = { id: 'a', name: 'app', env: 'A=1\nTOKEN=x', buildArgs: 'B=2' };

  it('blanks env and build args for viewers and flags it', () => {
    const out = hideEnv(row, false);
    expect(out).toEqual({
      id: 'a',
      name: 'app',
      env: null,
      buildArgs: null,
      envHidden: true,
    });
    expect(JSON.stringify(out)).not.toContain('TOKEN');
  });

  it('keeps the values for developers and up', () => {
    expect(hideEnv(row, true)).toEqual({ ...row, envHidden: false });
  });

  it('does not invent build args on stacks', () => {
    expect(hideEnv({ env: 'A=1' }, true)).toEqual({
      env: 'A=1',
      envHidden: false,
    });
    expect(hideEnv({ env: 'A=1' }, false)).toEqual({
      env: null,
      envHidden: true,
    });
  });
});
