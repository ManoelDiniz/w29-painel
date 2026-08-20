import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Só os arquivos .spec.ts ao lado do código que testam. Uma pasta
    // /test separada faz o teste envelhecer longe da função — e ninguém
    // lembra de abrir a outra pasta ao mexer numa regra.
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
})
