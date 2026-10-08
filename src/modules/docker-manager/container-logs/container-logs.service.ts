import { Injectable, NotFoundException } from '@nestjs/common';
import { DockerContainerLogsDto } from '../docker-manager.dto';
import { DockerTargetService } from '../docker-target.service';
import { isSafeContainerRef } from '../managed';

const MAX_LINES = 500;
const MAX_CHARS = 200_000;

/** Last `MAX_LINES` lines and at most `MAX_CHARS` characters, newest kept. Pure. */
export function clipLogs(
  text: string,
  maxLines = MAX_LINES,
  maxChars = MAX_CHARS,
): DockerContainerLogsDto {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let truncated = lines.length > maxLines;
  let out = lines.slice(-maxLines).join('\n');
  if (out.length > maxChars) {
    out = out.slice(out.length - maxChars);
    truncated = true;
  }
  return { logs: out, truncated };
}

@Injectable()
export class ContainerLogsService {
  constructor(private readonly target: DockerTargetService) {}

  /**
   * One-shot tail — readable for managed containers too (viewing is not
   * destructive); only the action routes are refused for them.
   */
  async execute(
    ref: string,
    tail = 200,
    serverId?: string,
  ): Promise<DockerContainerLogsDto> {
    if (!isSafeContainerRef(ref)) {
      throw new NotFoundException('Container not found');
    }
    const handle = await this.target.handle(serverId);
    try {
      const found = await handle.engine.inspectContainer(ref);
      if (!found) throw new NotFoundException('Container not found');
      const text = await handle.engine.containerLogs(found.Id, tail);
      return clipLogs(text, tail);
    } catch (err) {
      throw this.target.toHttp(err);
    }
  }
}
