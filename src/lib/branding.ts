/**
 * Single source of truth for how the organisation is named in the UI and in
 * outbound SMS. Change these two lines to rebrand the whole application.
 */
export const ORG_NAME = "Mall Consultants";
export const PRODUCT_NAME = "Install Dispatch";
export const APP_TITLE = `${ORG_NAME} ${PRODUCT_NAME}`;

/**
 * Prefix used on outbound SMS so a contractor recognises the sender.
 *
 * This has to match the business registered for A2P 10DLC. Carriers compare
 * the sender named in a message against the registered brand, and a message
 * signed with a name that is not the registered one is what gets a campaign
 * rejected or a number filtered later.
 */
export const SMS_SENDER_LABEL = ORG_NAME;
