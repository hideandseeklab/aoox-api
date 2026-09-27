import { envUpsertLine } from './compose-apply.util';

describe('envUpsertLine', () => {
  it('replaces an existing KEY= line', () => {
    const line = envUpsertLine('WEB_DOMAIN', 'panel.example.com');
    expect(line).toContain("grep -q '^WEB_DOMAIN='");
    expect(line).toContain(
      'sed -i "s/^WEB_DOMAIN=.*/WEB_DOMAIN=panel.example.com/"',
    );
  });

  it('appends a new KEY=value line when the key is missing', () => {
    const line = envUpsertLine('PUBLIC_IP', '203.0.113.10');
    expect(line).toContain("echo 'PUBLIC_IP=203.0.113.10' >> .env.dist");
  });

  it('escapes sed-special characters in the value', () => {
    const line = envUpsertLine('REGISTRY_PUBLIC_HOST', 'a/b&c\\d');
    expect(line).toContain('REGISTRY_PUBLIC_HOST=a\\/b\\&c\\\\d');
  });

  it('allows an empty value (clears the variable)', () => {
    const line = envUpsertLine('TERMINAL_SSH_USER', '');
    expect(line).toContain(
      'sed -i "s/^TERMINAL_SSH_USER=.*/TERMINAL_SSH_USER=/"',
    );
    expect(line).toContain("echo 'TERMINAL_SSH_USER=' >> .env.dist");
  });
});
