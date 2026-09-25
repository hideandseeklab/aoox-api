import { Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { Template } from './template.types';
import { TEMPLATES } from './templates';

/** Default compose file name written for template stacks (bare name: `tarFiles` is flat). */
export const TEMPLATE_COMPOSE_PATH = 'docker-compose.yml';

/**
 * Letters and digits only: the value goes into `.aoox.env` (compose
 * interpolation reads `$`) and through `EnvResolverService` (`${{...}}`),
 * and is often pasted into shells/URLs — so no symbols at all.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateValue(kind: 'password' | 'secret'): string {
  const length = kind === 'secret' ? 48 : 24;
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** `${VAR}` names referenced by a compose file (`${VAR:-x}` too). */
export function referencedVariables(compose: string): Set<string> {
  const out = new Set<string>();
  for (const m of compose.matchAll(/\$\{([A-Z0-9_]+)(?:[:?-][^}]*)?\}/g)) {
    out.add(m[1]);
  }
  return out;
}

export class TemplateVariableError extends Error {}

/**
 * Resolves the env for a new stack: user values win, then defaults, then a
 * generated value for `generate` variables; required variables without any
 * value are an error. Unknown keys are ignored (the DTO is a plain record).
 */
export function renderEnv(
  template: Template,
  values: Record<string, string>,
): string {
  const lines: string[] = [];
  for (const v of template.variables) {
    let value = values[v.key]?.trim() ?? '';
    if (!value && v.generate) value = generateValue(v.generate);
    if (!value && v.default !== undefined) value = v.default;
    if (!value && v.required) {
      throw new TemplateVariableError(`${v.label} (${v.key}) wajib diisi`);
    }
    if (/[\r\n]/.test(value)) {
      throw new TemplateVariableError(`${v.key} tidak boleh multi-baris`);
    }
    lines.push(`${v.key}=${value}`);
  }
  return lines.join('\n');
}

@Injectable()
export class TemplateService {
  list(): readonly Template[] {
    return TEMPLATES;
  }

  findOrFail(id: string): Template {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }
}
