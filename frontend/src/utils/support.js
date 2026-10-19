/* Where "buy me a coffee" goes.
 *
 * One constant rather than three copies of a URL, because it appears at the
 * foot of the rail, in the account menu (which is the rail's stand-in on
 * phones) and on the Plan page.
 *
 * It is a link out and nothing more: no payment is handled here, no account is
 * involved, and nothing that happens on the other side changes a limit or
 * unlocks anything. That is the whole design — the limits move when the admin
 * moves them, by hand, and a page that took money for them would be a
 * different app with different obligations.
 */
export const COFFEE_URL = "https://buymeacoffee.com/spsuryamisz";
