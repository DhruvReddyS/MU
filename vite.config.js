import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  appType: 'spa',
  plugins: [
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'generateSW',
      devOptions: {
        enabled: false,
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'offline.html',
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'CacheFirst',
            options: {
              cacheName: 'trinetra-pages',
            },
          },
          {
            urlPattern: ({ request }) =>
              request.destination === 'script' ||
              request.destination === 'style',
            handler: 'CacheFirst',
            options: {
              cacheName: 'trinetra-assets',
            },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'trinetra-images',
            },
          },
        ],
      },
      manifest: {
        name: 'TRINETRA',
        short_name: 'TRINETRA',
        description: 'Tactical offline mesh communication — see beyond the blackout. Emergency alerts, safe routes, and field intelligence without internet.',
        theme_color: '#c41a1a',
        background_color: '#040404',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/branding/trinetra-mark.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/manifest-icon-192.maskable.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/manifest-icon-512.maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5174,
    https: true,
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    https: true,
  },
});
