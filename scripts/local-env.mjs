import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const destination = fileURLToPath(new URL('../.env.local', import.meta.url));
if (!existsSync(destination)) {
  writeFileSync(destination, `BETTER_AUTH_SECRET=${randomBytes(48).toString('hex')}\n`, { mode: 0o600 });
}
process.loadEnvFile(destination);
