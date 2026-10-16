'use client';

export function LogoutButton() {
  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <button onClick={handleLogout} className="text-sm text-inkMuted hover:text-ink">
      Déconnexion
    </button>
  );
}
