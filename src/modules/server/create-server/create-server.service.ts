import { BadRequestException, Injectable } from '@nestjs/common';
import { utils } from 'ssh2';
import { ServerDto, ServerService } from '../server.service';
import { CreateServerDto } from './create-server.dto';

@Injectable()
export class CreateServerService {
  constructor(private readonly servers: ServerService) {}

  async execute(dto: CreateServerDto): Promise<ServerDto> {
    const privateKey = dto.privateKey?.trim();
    if (privateKey && utils.parseKey(privateKey) instanceof Error) {
      throw new BadRequestException(
        'privateKey is not a valid unencrypted OpenSSH/PEM private key',
      );
    }
    const entity = this.servers.repo.create({
      name: dto.name.trim(),
      host: dto.host.trim(),
      port: dto.port ?? 22,
      username: dto.username.trim(),
      privateKeyEncrypted: privateKey
        ? this.servers.encryptPrivateKey(privateKey)
        : null,
    });
    const saved = await this.servers.repo.save(entity);
    return this.servers.toDto(saved, !!privateKey);
  }
}
