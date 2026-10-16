import nodemailer from 'nodemailer';

import { env } from './config';

let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (!env.smtp.host() || !env.smtp.user() || !env.smtp.password()) {
    return null; // SMTP non configuré — récupération par email indisponible
  }
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      host: env.smtp.host()!,
      port: env.smtp.port(),
      secure: env.smtp.secure(),
      auth: { user: env.smtp.user()!, pass: env.smtp.password()! },
    });
  }
  return cachedTransporter;
}

/**
 * Envoie le code de récupération du PIN de compte — un code à 6
 * chiffres, valable 15 minutes, à usage unique. Renvoie false si SMTP
 * n'est pas configuré (le code appelant doit gérer ce cas), sans jamais
 * lever d'exception pour un simple défaut de configuration.
 */
export async function sendPinResetCode(email: string, code: string): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;

  await transporter.sendMail({
    from: `"Dream-Films" <${env.smtp.sender()}>`,
    to: email,
    subject: 'Code de récupération de ton PIN — Dream-Films',
    text: `Voici ton code pour redéfinir le PIN de gestion des profils :\n\n${code}\n\nCe code expire dans 15 minutes et ne peut être utilisé qu'une seule fois. Si tu n'es pas à l'origine de cette demande, ignore cet email — ton PIN actuel reste valide.`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h1 style="font-size: 20px;">Récupération du PIN</h1>
        <p>Voici ton code pour redéfinir le PIN de gestion des profils :</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;
                  background:#0B0F1A;color:#E8B54A;padding:16px;border-radius:8px;">
          ${code}
        </p>
        <p style="color:#8A93A6;font-size:13px;">
          Ce code expire dans 15 minutes et ne peut être utilisé qu'une seule
          fois. Si tu n'es pas à l'origine de cette demande, ignore cet email
          — ton PIN actuel reste valide.
        </p>
      </div>
    `,
  });
  return true;
}
