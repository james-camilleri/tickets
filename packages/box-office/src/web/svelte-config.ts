import type { Config } from '@sveltejs/kit'

import adapter from '@sveltejs/adapter-auto'
import preprocess from 'svelte-preprocess'

export function createSvelteConfig(config?: Config) {
  return {
    ...config,
    preprocess: preprocess() || config?.preprocess,
    kit: {
      adapter: adapter(),
      files: {
        ...config?.kit?.files,
        appTemplate: 'node_modules/@the-gods/box-office/dist/web/app.html',
        routes: 'node_modules/@the-gods/box-office/dist/web/routes',
        lib: 'node_modules/@the-gods/box-office/dist/web/lib',
      },
      ...config?.kit,
    },
  }
}
