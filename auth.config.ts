// Schema-generation only: no file database and no persistent secret.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { createAuth } from './src/server/auth.ts';
export const auth = createAuth(new DatabaseSync(':memory:'), Array.from(randomBytes(48), b => b.toString(16).padStart(2, '0')).join(''), 'http://127.0.0.1:3007');
