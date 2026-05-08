import { defineConfig } from 'tsdown'

export default defineConfig({
    entry: {
        index: 'src/index.ts',
    },
    banner: {
        js: '#!/usr/bin/env node'
    },
    exports: true
})
