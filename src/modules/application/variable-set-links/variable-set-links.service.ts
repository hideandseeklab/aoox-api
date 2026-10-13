import { BadRequestException, Injectable } from '@nestjs/common';
import {
  LinkOwner,
  LinkView,
  VariableSetLinkService,
} from '../../variable-set/variable-set-link.service';
import { Application } from '../application.entity';
import { EnvReferenceError, EnvResolverService } from '../env-resolver.service';

/**
 * Validate-and-save of the ordered variable set links of an application or
 * a compose stack (compose passes its stack as an `Application`-shaped
 * object, as it already does for the resolver). Lives here because it needs
 * the resolver; ComposeModule imports ApplicationModule.
 */
@Injectable()
export class OwnerVariableSetsService {
  constructor(
    private readonly links: VariableSetLinkService,
    private readonly resolver: EnvResolverService,
  ) {}

  views(owner: LinkOwner, ownEnv: string): Promise<LinkView[]> {
    return this.links.views(owner, ownEnv);
  }

  /**
   * Every rule except saving: link rules (shared, unique, limit, protected
   * linking needs the project admin) and that the owner's env references
   * (`${{vars.KEY}}` and the rest) still resolve against the new list (400).
   */
  async check(
    owner: LinkOwner,
    target: Application,
    environmentIds: string[],
    actorId: string | null,
  ): Promise<void> {
    await this.links.validate(owner, environmentIds, actorId);
    await this.checkReferences(owner, target, environmentIds);
  }

  async checkReferences(
    owner: LinkOwner,
    target: Application,
    environmentIds?: string[],
  ): Promise<void> {
    try {
      await this.resolver.resolve(target, {
        lenient: true,
        owner: owner.kind,
        environmentIds,
      });
    } catch (err) {
      if (err instanceof EnvReferenceError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /** Validates, saves and returns the new list. Takes effect on the next deploy. */
  async replace(
    owner: LinkOwner & { id: string },
    target: Application,
    environmentIds: string[],
    actorId: string | null,
  ): Promise<LinkView[]> {
    await this.check(owner, target, environmentIds, actorId);
    await this.links.replace(owner.kind, owner.id, environmentIds);
    return this.links.views(owner, target.env, environmentIds);
  }
}
