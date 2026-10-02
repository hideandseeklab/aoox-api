import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  SecretConnectionDto,
  SecretSourceService,
} from '../secret-source.service';

/** Every member can list (names for the application's dropdown); no secrets in the DTO. */
@Controller('secret-connections')
@UseGuards(JwtAuthGuard)
export class ListSecretConnectionsController {
  constructor(private readonly secrets: SecretSourceService) {}

  @Get()
  async list(): Promise<SecretConnectionDto[]> {
    const rows = await this.secrets.repo.find({ order: { createdAt: 'ASC' } });
    return rows.map((r) => this.secrets.toDto(r));
  }
}
