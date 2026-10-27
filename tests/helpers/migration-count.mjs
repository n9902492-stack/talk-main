import {readdirSync} from 'node:fs';
export const sqliteMigrationCount=readdirSync(new URL('../../backend/src/migrations/',import.meta.url)).filter(name=>/^\d+_.+\.sql$/.test(name)).length;
