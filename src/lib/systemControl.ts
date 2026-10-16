import { execFile } from 'node:child_process';

// Liste FERMÉE d'actions possibles — jamais de commande construite à
// partir d'une chaîne envoyée par le client, pour exclure toute
// injection. Chaque action correspond à un appel `execFile` figé,
// execFile (pas exec) ne passe jamais par un shell donc aucun
// métacaractère n'est interprété même si jamais une valeur venait à s'y
// glisser.
export type ServiceName = 'account-portal' | 'media-catalog';
const SERVICES: ServiceName[] = ['account-portal', 'media-catalog'];

function run(cmd: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, output: (stdout || '') + (stderr || '') });
    });
  });
}

export function isValidService(name: string): name is ServiceName {
  return (SERVICES as string[]).includes(name);
}

export async function restartService(name: ServiceName) {
  return run('pm2', ['restart', name]);
}

export async function stopService(name: ServiceName) {
  return run('pm2', ['stop', name]);
}

export async function startService(name: ServiceName) {
  return run('pm2', ['start', name]);
}

export async function getServicesStatus() {
  const { ok, output } = await run('pm2', ['jlist']);
  if (!ok) return [];
  try {
    const list = JSON.parse(output) as Array<{
      name: string;
      pm2_env: { status: string; pm_uptime: number; restart_time: number };
      monit: { cpu: number; memory: number };
    }>;
    return list
      .filter((p) => SERVICES.includes(p.name as ServiceName))
      .map((p) => ({
        name: p.name,
        status: p.pm2_env.status,
        uptimeMs: p.pm2_env.status === 'online' ? Date.now() - p.pm2_env.pm_uptime : 0,
        restarts: p.pm2_env.restart_time,
        cpu: p.monit.cpu,
        memoryMb: Math.round(p.monit.memory / (1024 * 1024)),
      }));
  } catch {
    return [];
  }
}

/**
 * Redémarre le VPS entier — la commande la plus destructive disponible
 * ici (coupe TOUT, base de données incluse, le temps du redémarrage).
 * Le délai laisse le temps à la réponse HTTP de partir avant que le
 * process (et la machine) ne s'arrête.
 */
export function rebootServer() {
  setTimeout(() => {
    execFile('reboot', []);
  }, 800);
}

/**
 * Redémarre un service via pm2 — délai nécessaire quand le service visé
 * est CELUI qui exécute cette requête (media-catalog se redémarrant
 * lui-même) : sans ce délai, le process meurt avant que la réponse HTTP
 * n'ait pu être envoyée au client.
 */
export function restartServiceDelayed(name: ServiceName) {
  setTimeout(() => {
    execFile('pm2', ['restart', name]);
  }, 500);
}

export function stopServiceDelayed(name: ServiceName) {
  setTimeout(() => {
    execFile('pm2', ['stop', name]);
  }, 500);
}
