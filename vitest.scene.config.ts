import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/scene/sequence-loader.test.ts'],env:{NODE_ENV:'test'}}});
