import type { Metadata } from 'next';

import './globals.css';
import { LogoutButton } from './logout-button';

export const metadata: Metadata = {
  title: 'Dream-Films',
  description: 'Détection et catalogage automatique de bibliothèque média',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-background text-ink antialiased">
        <header className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <a href="/" className="font-semibold text-ink hover:text-accent">
              ← Dream-Films
            </a>
            <a href="/library" className="ml-6 text-sm text-inkMuted hover:text-ink">
              Bibliothèque
            </a>
          </div>
          <LogoutButton />
        </header>
        {children}
      </body>
    </html>
  );
}
