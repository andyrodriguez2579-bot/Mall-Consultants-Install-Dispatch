import type { EmailDriver, EmailSendResult } from "./driver";

/**
 * Development driver.
 *
 * Sends nothing, records everything. The message -- including the live sign-in
 * link -- goes to the server console and, by the caller, to email_messages, so
 * the whole email sign-in flow can be walked end to end before any email
 * provider exists: read the link out of the admin Messages view and open it.
 */
export const devDriver: EmailDriver = {
  name: "dev",

  async send({ to, subject, body, attachments }): Promise<EmailSendResult> {
    const rule = "─".repeat(64);
    // eslint-disable-next-line no-console -- this output is the feature
    console.log(
      [
        `\n┌${rule}`,
        `│ EMAIL (development mode — not sent)`,
        `│ To: ${to}`,
        `│ Subject: ${subject}`,
        ...(attachments && attachments.length > 0
          ? [`│ Attachments: ${attachments.map((a) => a.filename).join(", ")}`]
          : []),
        `├${rule}`,
        ...body.split("\n").map((line) => `│ ${line}`),
        `└${rule}\n`,
      ].join("\n"),
    );

    return {
      ok: true,
      status: "logged",
      providerId: `dev-${crypto.randomUUID()}`,
    };
  },
};
