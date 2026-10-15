import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import {
  ENV_TEXT_MAX,
  normalizeEnvText,
  rewriteProjectReferences,
} from './env-text';
import { VariableSetAccessService } from './variable-set-access.service';
import {
  ENVIRONMENT_NAME,
  VariableSetEnvironment,
} from './variable-set-environment.entity';
import {
  ExportedEnvironment,
  MAX_ENVIRONMENTS,
  VariableSetEnvironmentService,
} from './variable-set-environment.service';
import { MAX_LINKS, VariableSetLink } from './variable-set-link.entity';
import {
  SET_NAME_MAX,
  slugifySetName,
  uniqueSetName,
  uniqueSetSlug,
} from './variable-set-names';
import { VariableSetProject } from './variable-set-project.entity';
import { VariableSet } from './variable-set.entity';

/** A link in an export file: names only. */
export interface ExportedLink {
  set: string;
  environment: string;
}

/** A whole set in an export file (only with secrets, see `exportFor`). */
export interface ExportedVariableSet {
  name: string;
  slug?: string;
  description?: string | null;
  environments: ExportedEnvironment[];
}

/** The old (alpha.9) per-project environments section of an export file. */
export interface LegacyEnvironmentsInput {
  environments?: ExportedEnvironment[];
  /** Files from before environments: the project's shared env (into production). */
  projectEnv?: string;
}

/** What an import needs to link its applications and stacks. */
export interface ImportedSets {
  /** Environment ids for an exported link list (unknown entries become warnings). */
  linksFor(
    links: ExportedLink[] | undefined,
    legacyEnvironment: string | null | undefined,
    where: string,
  ): string[];
  /** Saves the links of a freshly imported owner. */
  save(
    kind: 'application' | 'compose',
    id: string,
    environmentIds: string[],
  ): Promise<void>;
}

/**
 * Variable sets in project export/import. A project file carries its
 * applications' and stacks' links by set NAME and environment name. Sets are
 * platform objects, so a file only carries whole sets when exported with
 * secrets (owner only), and an import never overwrites an existing set.
 */
@Injectable()
export class VariableSetTransferService {
  constructor(
    private readonly access: VariableSetAccessService,
    private readonly environments: VariableSetEnvironmentService,
  ) {}

  private get manager() {
    return this.access.sets.manager;
  }

  /**
   * Links per application / stack id, and (with `includeSecrets`) the sets
   * shared with the project explicitly or linked by one of its applications
   * or stacks, with their values.
   */
  async exportFor(
    projectId: string,
    includeSecrets: boolean,
    appIds: string[],
    stackIds: string[],
  ): Promise<{
    applications: Map<string, ExportedLink[]>;
    composeApps: Map<string, ExportedLink[]>;
    sets?: ExportedVariableSet[];
  }> {
    const links =
      appIds.length + stackIds.length === 0
        ? []
        : await this.manager.find(VariableSetLink, {
            where: [
              ...(appIds.length ? [{ applicationId: In(appIds) }] : []),
              ...(stackIds.length ? [{ composeAppId: In(stackIds) }] : []),
            ],
            order: { position: 'ASC' },
          });
    const envs = links.length
      ? await this.manager.find(VariableSetEnvironment, {
          where: { id: In([...new Set(links.map((l) => l.environmentId))]) },
        })
      : [];
    const shared = await this.manager.find(VariableSetProject, {
      where: { projectId },
    });
    const setIds = [
      ...new Set([
        ...envs.map((e) => e.variableSetId),
        ...shared.map((s) => s.variableSetId),
      ]),
    ];
    const sets = setIds.length
      ? await this.manager.find(VariableSet, { where: { id: In(setIds) } })
      : [];
    const setById = new Map(sets.map((s) => [s.id, s]));
    const envById = new Map(envs.map((e) => [e.id, e]));
    const applications = new Map<string, ExportedLink[]>();
    const composeApps = new Map<string, ExportedLink[]>();
    for (const l of links) {
      const env = envById.get(l.environmentId);
      const set = env && setById.get(env.variableSetId);
      if (!env || !set) continue;
      const map = l.applicationId ? applications : composeApps;
      const key = (l.applicationId ?? l.composeAppId)!;
      map.set(key, [
        ...(map.get(key) ?? []),
        { set: set.name, environment: env.name },
      ]);
    }
    if (!includeSecrets) return { applications, composeApps };
    const out: ExportedVariableSet[] = [];
    for (const s of [...sets].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({
        name: s.name,
        slug: s.slug,
        description: s.description,
        environments: await this.environments.exportOf(s.id, true),
      });
    }
    return { applications, composeApps, sets: out };
  }

  /**
   * Imports the sets of a file for a freshly created project and prepares
   * the linking. Untrusted input: bad names and oversized text become
   * warnings.
   * - `sets` (files exported with secrets): a set whose name already exists is
   *   reused and never overwritten; a new one is created and shared with the
   *   imported project only (any importer may do this: it is equivalent to the
   *   per-project environments of before).
   * - `legacy` (alpha.9 files with `environments`, or older ones with a
   *   project env): like the VariableSets migration, the non-empty
   *   environments become one set named after the project.
   * - Linking to an existing set requires it to be shared with the new
   *   project: shared with all projects is fine; otherwise an instance
   *   owner/admin importer shares it with the new project (warning), anyone
   *   else gets a warning and no link.
   * - `${{project.KEY}}` in imported texts becomes `${{vars.KEY}}`.
   */
  async importFor(
    projectId: string,
    projectName: string,
    actorId: string,
    sets: ExportedVariableSet[] | undefined,
    legacy: LegacyEnvironmentsInput,
    warnings: string[],
  ): Promise<ImportedSets> {
    const ctx = await this.access.context(actorId);
    const existing = await this.manager.find(VariableSet);
    const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s]));
    const takenNames = existing.map((s) => s.name);
    const takenSlugs = existing.map((s) => s.slug);
    /** Set id -> environment name -> id, for every set the import may link to. */
    const envIndex = new Map<string, Map<string, string>>();
    const sharedWithProject = new Set<string>();
    const createdNames = new Map<string, VariableSet>();

    const indexEnvironments = async (setId: string) => {
      if (envIndex.has(setId)) return;
      const envs = await this.manager.find(VariableSetEnvironment, {
        where: { variableSetId: setId },
        select: { id: true, name: true },
      });
      envIndex.set(setId, new Map(envs.map((e) => [e.name, e.id])));
    };

    const createSet = async (
      wantedName: string,
      wantedSlug: string | undefined,
      description: string | null,
      environments: ExportedEnvironment[],
      where: string,
    ): Promise<VariableSet | null> => {
      const rows: VariableSetEnvironment[] = [];
      const withoutValues: string[] = [];
      for (const e of environments.slice(0, MAX_ENVIRONMENTS)) {
        if (typeof e?.name !== 'string' || !ENVIRONMENT_NAME.test(e.name)) {
          warnings.push(
            `${where}: environment "${String(e?.name).slice(0, 40)}" has an invalid name, skipped`,
          );
          continue;
        }
        if (rows.some((r) => r.name === e.name)) continue;
        const text = rewriteProjectReferences(
          normalizeEnvText(typeof e.variables === 'string' ? e.variables : ''),
        );
        if (text.length > ENV_TEXT_MAX) {
          warnings.push(
            `${where}: environment "${e.name}" is too large, left empty`,
          );
        } else if (e.variables === undefined) {
          withoutValues.push(e.name);
        }
        const row = this.manager.create(VariableSetEnvironment, {
          name: e.name,
          protected: e.protected === true,
          keys: [],
          secretFlags: {},
          notes: {},
        });
        if (text.length <= ENV_TEXT_MAX) {
          this.environments.sealImported(row, text, e.secretKeys, e.plainKeys);
        }
        rows.push(row);
      }
      if (environments.length > MAX_ENVIRONMENTS) {
        warnings.push(
          `${where}: only the first ${MAX_ENVIRONMENTS} environments were imported`,
        );
      }
      if (withoutValues.length > 0) {
        warnings.push(
          `${where}: environments exported without secrets (${withoutValues.join(', ')}): variables left empty`,
        );
      }
      if (rows.length === 0) return null;
      const name = uniqueSetName(wantedName.slice(0, SET_NAME_MAX), takenNames);
      const slug = uniqueSetSlug(
        wantedSlug && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(wantedSlug)
          ? wantedSlug
          : slugifySetName(name),
        takenSlugs,
      );
      takenNames.push(name);
      takenSlugs.push(slug);
      const set = await this.manager.transaction(async (m) => {
        const saved = await m.save(
          m.create(VariableSet, {
            name,
            slug,
            description: description?.slice(0, 500) || null,
            sharedWithAll: false,
          }),
        );
        await m.insert(VariableSetProject, {
          variableSetId: saved.id,
          projectId,
        });
        for (const r of rows) r.variableSetId = saved.id;
        await m.save(rows);
        return saved;
      });
      if (name !== wantedName) {
        warnings.push(
          `${where}: a variable set named "${wantedName}" exists, created "${name}"`,
        );
      }
      sharedWithProject.add(set.id);
      envIndex.set(set.id, new Map(rows.map((r) => [r.name, r.id])));
      return set;
    };

    for (const s of Array.isArray(sets) ? sets : []) {
      if (typeof s?.name !== 'string' || !s.name.trim()) {
        warnings.push('variable set without a name skipped');
        continue;
      }
      const name = s.name.trim();
      const where = `variable set "${name.slice(0, 60)}"`;
      const found = byName.get(name.toLowerCase());
      if (found) {
        warnings.push(
          `${where}: already exists on this instance, linked as it is (not overwritten from the file)`,
        );
        continue;
      }
      const set = await createSet(
        name,
        typeof s.slug === 'string' ? s.slug : undefined,
        typeof s.description === 'string' ? s.description : null,
        Array.isArray(s.environments) ? s.environments : [],
        where,
      );
      if (set) createdNames.set(name.toLowerCase(), set);
    }

    // Old files: one set named after the project from the non-empty environments.
    let legacySet: VariableSet | null = null;
    const legacyEnvs = Array.isArray(legacy.environments)
      ? [...legacy.environments]
      : [];
    if (legacy.projectEnv?.trim()) {
      const prod = legacyEnvs.find((e) => e?.name === 'production');
      if (!prod?.variables?.trim()) {
        const rest = legacyEnvs.filter((e) => e?.name !== 'production');
        rest.push({
          name: 'production',
          protected: true,
          variables: legacy.projectEnv,
        });
        legacyEnvs.splice(0, legacyEnvs.length, ...rest);
      }
    }
    if (legacyEnvs.length > 0) {
      const withValues = legacyEnvs.filter(
        (e) => typeof e?.variables === 'string' && e.variables.trim() !== '',
      );
      if (withValues.length < legacyEnvs.length) {
        const skipped = legacyEnvs
          .filter((e) => !withValues.includes(e))
          .map((e) => String(e?.name).slice(0, 40));
        warnings.push(
          `environments without variables are not imported (${skipped.join(', ')})`,
        );
      }
      if (withValues.length > 0) {
        legacySet = await createSet(
          projectName,
          undefined,
          null,
          withValues,
          'environments',
        );
        if (legacySet) {
          warnings.push(
            `the file's project environments became the variable set "${legacySet.name}"`,
          );
        }
      }
    }

    const shareNow = new Set<string>();
    const resolveSet = (name: string, where: string): VariableSet | null => {
      const key = name.toLowerCase();
      const set = createdNames.get(key) ?? byName.get(key);
      if (!set) {
        warnings.push(`${where}: variable set "${name}" not found, not linked`);
        return null;
      }
      if (set.sharedWithAll || sharedWithProject.has(set.id)) return set;
      if (ctx.platform) {
        shareNow.add(set.id);
        sharedWithProject.add(set.id);
        warnings.push(
          `variable set "${set.name}" was shared with the imported project`,
        );
        return set;
      }
      warnings.push(
        `${where}: variable set "${set.name}" is not shared with this project, not linked`,
      );
      return null;
    };

    // Existing sets need their environments indexed before linking (a
    // handful of rows; `linksFor` is synchronous).
    for (const s of existing) await indexEnvironments(s.id);

    return {
      linksFor: (links, legacyEnvironment, where) => {
        const out: string[] = [];
        if (Array.isArray(links)) {
          for (const l of links) {
            if (
              typeof l?.set !== 'string' ||
              typeof l?.environment !== 'string'
            ) {
              warnings.push(`${where}: invalid variable set link skipped`);
              continue;
            }
            const set = resolveSet(l.set, where);
            if (!set) continue;
            const id = envIndex.get(set.id)?.get(l.environment);
            if (!id) {
              warnings.push(
                `${where}: environment "${l.environment}" of variable set "${set.name}" not found, not linked`,
              );
              continue;
            }
            if (!out.includes(id)) out.push(id);
          }
        } else if (legacySet) {
          // Old files: the app followed one project environment (production
          // when the field is absent); linked when that environment had values.
          const id = envIndex
            .get(legacySet.id)
            ?.get(legacyEnvironment || 'production');
          if (id) out.push(id);
        }
        if (out.length > MAX_LINKS) {
          warnings.push(
            `${where}: only the first ${MAX_LINKS} variable set links were kept`,
          );
        }
        return out.slice(0, MAX_LINKS);
      },
      save: async (kind, id, environmentIds) => {
        for (const setId of [...shareNow]) {
          await this.manager
            .createQueryBuilder()
            .insert()
            .into(VariableSetProject)
            .values({ variableSetId: setId, projectId })
            .orIgnore()
            .execute();
          shareNow.delete(setId);
        }
        if (environmentIds.length === 0) return;
        await this.manager.insert(
          VariableSetLink,
          environmentIds.map((environmentId, position) => ({
            environmentId,
            position,
            applicationId: kind === 'application' ? id : null,
            composeAppId: kind === 'compose' ? id : null,
          })),
        );
      },
    };
  }
}
