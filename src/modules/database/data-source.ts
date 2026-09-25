import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildDatabaseOptions } from './database.config';

// Used by the TypeORM CLI (migration:generate / migration:run).
export default new DataSource(buildDatabaseOptions());
