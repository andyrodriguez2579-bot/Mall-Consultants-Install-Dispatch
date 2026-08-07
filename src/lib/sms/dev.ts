import type { SmsDriver, SmsSendResult } from "./driver";

/**
 * Development driver.
 *
 * Sends nothing. Prints the message -- including the secure link -- to the
 * server console and reports success, so the entire dispatch and acceptance
 * flow can be exercised end to end with no Twilio account and no real handset.
 *
 * Every message is still persisted to sms_messages by the caller, so the admin
 * "Messages" view works identically in development and production.
 */
export const devDriver: SmsDriver = {
  name: "dev",

  async send({ to, body }): Promise<SmsSendResult> {
    const rule = "─".repeat(64);
    // eslint-disable-next-line no-console -- this output is the feature
    console.log(
      [
        `\n┌${rule}`,
        `│ SMS (development mode — not sent)`,
        `│ To: ${to}`,
        `├${rule}`,
        ...body.split("\n").map((line) => `│ ${line}`),
        `└${rule}\n`,
      ].join("\n"),
    );

    return {
      ok: true,
      status: "logged",
      providerSid: `dev-${crypto.randomUUID()}`,
    };
  },
};
