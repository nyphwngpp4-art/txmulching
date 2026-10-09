import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          r2Buckets: ['LEAD_PHOTOS'],
          bindings: {
            DEMO_STUB: '1',
            PHOTO_LINK_SECRET: 'test-photo-secret',
            APPS_SCRIPT_TOKEN: 'test-token',
            FORWARD_TIMEOUT_MS: '80'
          }
        }
      }
    }
  }
});
