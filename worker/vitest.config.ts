import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Tests use a stand-in model, so no Cloudflare login is needed.
      remoteBindings: false,
      miniflare: { bindings: { APP_TOKEN: 'test-token' } },
    }),
  ],
});
