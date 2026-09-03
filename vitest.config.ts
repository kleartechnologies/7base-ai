import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Unit tests for the parts of MARKA where being wrong is expensive: URL
 * safety, website extraction, Business Brain validation, and the authority
 * rules that decide whether a discovery may overwrite what the owner said.
 *
 * Deliberately no DOM environment and no Firebase — everything under test is
 * a pure function, which is why these modules were written to be pure.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'functions/src/**/*.test.ts'],
  },
})
