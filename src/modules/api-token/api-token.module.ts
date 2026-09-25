import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectModule } from '../project/project.module';
import { ApiTokenService } from './api-token.service';
import { CreateApiTokenController } from './create-api-token/create-api-token.controller';
import { DeleteApiTokenController } from './delete-api-token/delete-api-token.controller';
import { ListApiTokensController } from './list-api-tokens/list-api-tokens.controller';
import { ApiToken } from './api-token.entity';

/** Global so `JwtAuthGuard` (instantiated in every module) can resolve tokens. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ApiToken]), ProjectModule],
  controllers: [
    CreateApiTokenController,
    ListApiTokensController,
    DeleteApiTokenController,
  ],
  providers: [ApiTokenService],
  exports: [ApiTokenService],
})
export class ApiTokenModule {}
