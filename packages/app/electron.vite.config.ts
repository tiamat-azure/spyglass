import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

function copyGuestResources() {
  return {
    name: 'copy-guest-resources',
    buildStart(): void {
      mkdirSync(resolve('out/resources'), { recursive: true });
      cpSync(resolve('resources'), resolve('out/resources'), { recursive: true });
    },
    closeBundle(): void {
      mkdirSync(resolve('out/resources'), { recursive: true });
      cpSync(resolve('resources'), resolve('out/resources'), { recursive: true });
    }
  };
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: ['@spyglass/probe', '@spyglass/contracts'] }),
      copyGuestResources()
    ]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    }
  }
});
