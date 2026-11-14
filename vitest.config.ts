import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Os testes de integração compartilham o mesmo banco: rodar arquivos em série evita interferência.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Arquivos de bootstrap (sobem processo/servidor) ficam fora: não têm regra de negócio.
      exclude: ['src/server.ts', 'src/infra/db/migrate.ts'],
      reporter: ['text', 'html', 'json-summary'],
      // Coverage mínimo declarado. O CI falha se ficar abaixo disto.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
