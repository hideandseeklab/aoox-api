import { Module } from '@nestjs/common';
import { SshKeyService } from './ssh-key.service';

/** SSH primitives shared by the terminal (host shell) and server (remote VPS) modules. */
@Module({
  providers: [SshKeyService],
  exports: [SshKeyService],
})
export class SshModule {}
