import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
// Database integration tests must never fall back to the application's .env.local.
const testName=process.env.NAVAIR_TEST_DATABASE;
if(!testName || !/^navair_test_[a-f0-9]{16}$/.test(testName))throw new Error('Run tests with npm test; direct Vitest runs cannot use the application database.');
for(const key of ['DATABASE_URL','ADMIN_DATABASE_URL']){
 const url=new URL(process.env[key]??'http://invalid');
 if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!==`/${testName}`)throw new Error('Tests require the disposable local database created by npm test.');
}
// Components import shared logic through the '@/' alias that Next resolves at build time;
// Vitest needs the same mapping or any test that pulls in a component fails to load.
export default defineConfig({
 resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
 test: { fileParallelism: false, testTimeout: 20000, env: { NODE_ENV: 'test' } },
});
