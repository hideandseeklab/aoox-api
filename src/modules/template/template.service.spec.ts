import {
  generateValue,
  referencedVariables,
  renderEnv,
  TemplateVariableError,
} from './template.service';
import { TEMPLATES } from './templates';

describe('template catalog', () => {
  it('has unique ids and every service to expose exists in the compose file', () => {
    const ids = new Set(TEMPLATES.map((t) => t.id));
    expect(ids.size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
      expect(t.services.length).toBeGreaterThan(0);
      for (const s of t.services) {
        expect(t.compose).toMatch(new RegExp(`^  ${s.service}:$`, 'm'));
      }
    }
  });

  it('declares exactly the ${VAR}s each compose file uses', () => {
    for (const t of TEMPLATES) {
      const declared = new Set(t.variables.map((v) => v.key));
      const used = referencedVariables(t.compose);
      expect([...used].sort()).toEqual([...declared].sort());
    }
  });

  it('never bakes a literal secret: every password/secret variable is generated', () => {
    for (const t of TEMPLATES) {
      for (const v of t.variables) {
        if (/PASSWORD|SECRET|KEY/.test(v.key)) {
          expect(v.generate).toBeDefined();
        }
      }
    }
  });
});

describe('renderEnv', () => {
  const template = TEMPLATES.find((t) => t.id === 'wordpress')!;

  it('generates missing secrets and keeps user values', () => {
    const env = renderEnv(template, { DB_PASSWORD: 'mine' });
    expect(env).toMatch(/^DB_PASSWORD=mine$/m);
    expect(env).toMatch(/^DB_ROOT_PASSWORD=[A-Za-z0-9]{24}$/m);
  });

  it('fails on a missing required value and on newlines', () => {
    const n8n = TEMPLATES.find((t) => t.id === 'n8n')!;
    expect(() => renderEnv(n8n, {})).toThrow(TemplateVariableError);
    expect(() => renderEnv(n8n, { N8N_HOST: 'a\nb' })).toThrow(
      TemplateVariableError,
    );
    expect(renderEnv(n8n, { N8N_HOST: 'n8n.example.com' })).toMatch(
      /^N8N_PROTOCOL=https$/m,
    );
  });
});

describe('generateValue', () => {
  it('is alphanumeric only (safe for env files, compose interpolation and URLs)', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateValue('password')).toMatch(/^[A-Za-z0-9]{24}$/);
      expect(generateValue('secret')).toMatch(/^[A-Za-z0-9]{48}$/);
    }
  });
});
