import Mailgun from "mailgun.js";
import FormData from "form-data";

const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY ?? "";
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN ?? "";
const FROM_ADDRESS = process.env.MAILGUN_FROM ?? `noreply@${MAILGUN_DOMAIN}`;

const mailgun = new Mailgun(FormData);

export async function sendRecoveryEmail(
  to: string,
  username: string,
  resetLink: string,
  siteUrl: string
): Promise<void> {
  const client = mailgun.client({ username: "api", key: MAILGUN_API_KEY });

  await client.messages.create(MAILGUN_DOMAIN, {
    from: FROM_ADDRESS,
    to,
    template: "recover",
    "h:X-Mailgun-Variables": JSON.stringify({
      reset_link: resetLink,
      site_url: siteUrl,
      username,
    }),
  });
}
