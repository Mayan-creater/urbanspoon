import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Urban Spoon Delivery',
    short_name: 'Urban Spoon',
    description: 'Delivery partner workspace for Urban Spoon.',
    start_url: '/delivery',
    display: 'standalone',
    background_color: '#f4f2e9',
    theme_color: '#315842',
    icons: [
      {
        src: '/delivery-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
