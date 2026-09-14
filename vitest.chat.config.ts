import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Chat tests mock the provider and import no database modules.
// Keep them isolated from the disposable-database integration suite.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['tests/chat.test.ts'], env: { NODE_ENV: 'test' } },
});
