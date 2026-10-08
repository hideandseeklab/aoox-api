import { errorsAbout } from './traefik-log';

describe('errorsAbout', () => {
  it('keeps error lines naming the file or one of its elements', () => {
    const log = [
      'time=1 level=error msg="x" file=/etc/traefik/dynamic/user-foo.yml',
      'time=2 level=error msg="middleware mw@file broken"',
      'time=3 level=info msg="user-foo.yml loaded"',
      'time=4 level=error msg="about another file user-bar.yml"',
    ].join('\n');
    expect(errorsAbout(log, 'user-foo.yml', ['mw@file'])).toEqual([
      'time=1 level=error msg="x" file=/etc/traefik/dynamic/user-foo.yml',
      'time=2 level=error msg="middleware mw@file broken"',
    ]);
  });

  it('understands console and JSON formats, strips colors and cuts long lines', () => {
    const colored = '\u001b[1;31mERR\u001b[0m bad thing in user-foo.yml';
    expect(errorsAbout(colored, 'user-foo.yml', [])).toEqual([
      'ERR bad thing in user-foo.yml',
    ]);
    const json = '{"level":"error","msg":"nope","file":"user-foo.yml"}';
    expect(errorsAbout(json, 'user-foo.yml', [])).toEqual([json]);
    const long = `level=error user-foo.yml ${'x'.repeat(400)}`;
    expect(errorsAbout(long, 'user-foo.yml', [])[0].length).toBe(301);
  });

  it('drops timestamps and collapses repeated lines', () => {
    const line =
      '2026-10-06T03:13:16.910818759Z 2026-10-06T03:13:16Z ERR Error occurred error="x: /etc/traefik/dynamic/user-foo.yml: field not found"';
    expect(
      errorsAbout(
        `${line}
${line}
${line}`,
        'user-foo.yml',
        [],
      ),
    ).toEqual([
      'ERR Error occurred error="x: /etc/traefik/dynamic/user-foo.yml: field not found"',
    ]);
  });

  it('is empty for a clean log', () => {
    expect(errorsAbout('', 'user-foo.yml', [])).toEqual([]);
    expect(
      errorsAbout('level=warn msg=user-foo.yml', 'user-foo.yml', []),
    ).toEqual([]);
  });
});
