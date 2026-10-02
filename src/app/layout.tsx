import type { Metadata } from 'next';
import '@ibm/plex-sans/css/ibm-plex-sans-default.min.css';
import '@ibm/plex-mono/css/ibm-plex-mono-default.min.css';
import './globals.scss';

export const metadata: Metadata = {
  title: 'Orion',
  description: 'Staff control panel for ServiceFlow',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
