import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works under https://<user>.github.io/<repo>/
  base: './',
  test: { environment: 'node' },
});
