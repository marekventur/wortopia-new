import Mailgun from "mailgun.js";
import FormData from "form-data";

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY ?? "";
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN ?? "";
const FROM_ADDRESS = process.env.MAILGUN_FROM ?? `noreply@${MAILGUN_DOMAIN}`;

const mailgun = new Mailgun(FormData);

export async function sendOtpEmail(to: string, code: string, siteUrl: string): Promise<void> {
  const client = mailgun.client({ username: "api", key: MAILGUN_API_KEY, url: "https://api.eu.mailgun.net" });

  await client.messages.create(MAILGUN_DOMAIN, {
    from: FROM_ADDRESS,
    to,
    subject: `Dein Wortopia-Code: ${code}`,
    text: `Dein Wortopia-Code lautet: ${code}\n\nDer Code ist 10 Minuten gültig.\n\n${siteUrl}`,
    html: `<p>Dein Wortopia-Code lautet:</p><p style="font-size:2em;font-weight:bold;letter-spacing:0.2em">${code}</p><p>Der Code ist 10 Minuten gültig.</p>`,
  });
}
