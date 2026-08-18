import { ORG_NAME } from "@/lib/branding";

/**
 * The SMS consent sentence, in one place.
 *
 * It is rendered on the application form and, when someone ticks the box,
 * stored verbatim on their application. Those must be the same string: consent
 * evidence that points at whatever the page says today proves nothing about
 * what a person agreed to two years ago, and the page will be edited.
 *
 * The wording itself is what A2P campaign review looks for -- who is sending,
 * what they are sending, that rates may apply, that frequency varies, and how
 * to stop -- and it matches the published consent page word for word.
 */
export const SMS_CONSENT_TEXT =
  `I consent to receive SMS job offers and job-related notifications from ` +
  `${ORG_NAME} at the mobile number provided above. Message and data rates may ` +
  `apply. Message frequency varies with the amount of work available. Reply ` +
  `STOP to opt out, HELP for help.`;

/**
 * Stated next to the box, and the reason a campaign registration was rejected
 * once already: consent that is a condition of the service is not consent.
 */
export const SMS_CONSENT_OPTIONAL_NOTE =
  `This is optional. It is not a condition of joining the ${ORG_NAME} contractor ` +
  `roster, of being offered work, or of being paid. If you decline we will ` +
  `contact you about available work by phone or email instead.`;
