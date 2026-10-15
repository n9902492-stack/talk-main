import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { openAuthDatabase } from './database.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const database = openAuthDatabase(path.resolve(root, process.env.AUTH_DATABASE_PATH || 'data/talk.sqlite'));
database.close();
console.log('Talk authentication database migrations are up to date.');
