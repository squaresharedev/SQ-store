/**
 * WHAT THE WORDS MEAN, before anything tries to match them.
 *
 * The ranker compares strings. This module is the layer underneath that turns
 * what a person typed into the strings worth comparing, and it exists because
 * three whole classes of miss have nothing to do with matching quality:
 *
 *   1. SPELLING. Half the labels in this app say "colour" and half the
 *      keywords say "color". Canonicalising BOTH sides means neither the
 *      person typing nor the person writing a label ever has to think about it.
 *   2. ABBREVIATION. "bg" is not a typo for "background" and no edit-distance
 *      bound will ever reach it; it is a different word that means the same
 *      thing, and only a table knows that.
 *   3. SENTENCES. People type "change the bg colour of my store", not
 *      "background". The filler has to stop counting against a result without
 *      being thrown away, because "show header" and "hide sold out" are real
 *      setting names built out of exactly those words.
 *
 * Everything here is generic vocabulary: spelling, abbreviations, word forms.
 * DOMAIN synonyms ("wallpaper" for the background, "payouts" for payments)
 * belong on the entries themselves, next to the thing they describe, which is
 * where the registry and the storefront settings catalogue keep them.
 */

import { charMask } from "@/lib/search/fuzzy";

/**
 * Case- and accent-fold for comparison. NFD + stripping combining marks means
 * "cafe" finds "Café", which matters because the DB side cannot do this
 * (`unaccent` is not enabled) and the local registry may as well be kinder.
 *
 * `\p{Diacritic}` rather than a U+0300-U+036F character class on purpose: a
 * literal range would put raw combining characters into this source file,
 * where they are invisible and one careless edit from being mangled.
 */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * British to American, one way, applied to both the query and the text being
 * searched so the two always meet in the middle.
 *
 * An explicit list rather than a suffix rule, because "-our" to "-or" also
 * rewrites "four", "your" and "hour". Small on purpose: only words this app
 * actually says.
 */
const SPELLING: Record<string, string> = {
  colour: "color",
  colours: "colors",
  coloured: "colored",
  behaviour: "behavior",
  favourite: "favorite",
  favourites: "favorites",
  catalogue: "catalog",
  catalogues: "catalogs",
  centre: "center",
  centred: "centered",
  grey: "gray",
  greyscale: "grayscale",
  cancelled: "canceled",
  licence: "license",
  analyse: "analyze",
  customise: "customize",
  personalise: "personalize",
  organise: "organize",
  organisation: "organization",
  authorise: "authorize",
  cheque: "check",
};

/** One folded word in its canonical spelling. */
export function canonical(word: string): string {
  return SPELLING[word] ?? word;
}

/**
 * ABBREVIATIONS AND SHORT FORMS: a token to the full word or words it stands
 * for. Matches against these score slightly below a literal hit, so a real
 * word always wins its own tie.
 *
 * Keys are canonical-spelled and folded. Values are single words wherever
 * possible: the ranker matches token against word, so "profile photo" as one
 * value would only ever match a term containing that exact pair.
 */
const ALIASES: Record<string, readonly string[]> = {
  // Background, the single most abbreviated word in any design tool.
  // "wallpaper" and "backdrop" are NOT here, on purpose. They are other names
  // for the thing rather than short forms of the word, so they live on the
  // Background entry itself, which is also what lets a result say which of
  // them it recognised.
  bg: ["background"],
  bkg: ["background"],
  bgd: ["background"],
  bground: ["background"],

  // Identity and imagery.
  pic: ["picture", "photo", "image", "avatar"],
  pics: ["picture", "photo", "image", "avatar"],
  pfp: ["photo", "avatar", "profile"],
  photo: ["picture", "image", "avatar"],
  picture: ["photo", "image", "avatar"],
  image: ["photo", "picture"],
  img: ["image", "photo", "picture"],
  avatar: ["photo", "picture", "profile"],
  logo: ["avatar", "photo", "picture"],

  // Credentials.
  pw: ["password"],
  pwd: ["password"],
  passwd: ["password"],
  pass: ["password"],
  login: ["signin", "password"],
  signin: ["login"],
  signout: ["logout"],
  logout: ["signout"],
  mfa: ["password", "security"],
  "2fa": ["password", "security"],

  // The store itself. "store" already reaches "storefront" by prefix; "shop"
  // and "site" do not, and are what half of everyone calls it.
  shop: ["storefront", "store"],
  site: ["storefront", "store"],

  // Generic short forms.
  acct: ["account"],
  addr: ["address"],
  desc: ["description"],
  qty: ["quantity", "stock"],
  msg: ["message"],
  nav: ["navigation", "menu"],
  config: ["settings", "configuration"],
  cfg: ["settings", "configuration"],
  prefs: ["preferences", "settings"],
  pref: ["preferences", "settings"],
  info: ["information", "details"],
  admin: ["team", "member", "access"],
  perms: ["permissions", "role", "access"],
  perm: ["permissions", "role", "access"],
  del: ["delete", "remove"],
  rm: ["delete", "remove"],
  txt: ["text"],
  num: ["number"],
  col: ["column", "color"],
  cols: ["columns"],
  px: ["size", "spacing"],

  // Layout words people reach for that the labels spell differently.
  round: ["rounded", "roundness", "radius", "corner"],
  rounded: ["roundness", "radius", "corner"],
  radius: ["roundness", "corner"],
  roundness: ["radius", "corner"],
  gap: ["spacing", "gutter"],
  spacing: ["gap", "gutter", "padding"],
  padding: ["spacing", "inset"],
  pos: ["position", "placement"],
  align: ["position", "placement", "alignment"],
  placement: ["position"],
  position: ["placement"],
  typeface: ["font", "typography"],
  vat: ["tax"],
  tax: ["vat"],
};

/**
 * WORDS THAT DO NOT NARROW ANYTHING.
 *
 * They are not removed, they are made OPTIONAL: a result is never required to
 * contain them, but still gets credit when it does. Deleting them outright
 * would be simpler and worse, because "show header", "hide sold out" and
 * "change email" are real terms in the index and the verb is half of each.
 *
 * Only fillers and generic intent verbs. Anything that names a thing, or
 * points at one thing rather than another (add, new, delete, remove, hide,
 * show), stays load-bearing.
 */
const SOFT_WORDS = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "by", "can", "could",
  "do", "does", "for", "from", "get", "go", "how", "i", "in", "into", "is",
  "it", "its", "me", "mine", "my", "of", "on", "or", "our", "please", "so",
  "that", "the", "their", "them", "then", "there", "these", "they", "this",
  "to", "up", "want", "wanna", "we", "what", "when", "where", "which", "who",
  "why", "will", "with", "would", "you", "your",
  // Intent verbs. "I want to CHANGE my password" says nothing about which
  // setting; the noun after it says everything.
  "change", "changing", "edit", "editing", "set", "setting", "settings",
  "update", "updating", "modify", "adjust", "make", "making", "let", "need",
  "help", "find", "look", "looking", "fix", "put", "use", "using", "give",
]);

/** Splits on whitespace and on the separators that show up in labels, slugs,
 *  routes and emails, so "/settings/account" and "a@b.com" both become words. */
export function splitWords(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Fold, split, and canonicalise the spelling of every word. The one function
 *  both sides of a comparison go through. */
export function normalizeWords(text: string): string[] {
  return splitWords(fold(text)).map(canonical);
}

/** One word of the query, with everything it is allowed to match. */
export type QueryToken = {
  /** The word as typed, folded and canonically spelled. */
  text: string;
  /**
   * Alternatives to try, each with the discount applied to a match on it, so
   * a literal hit always outranks a guess. Includes `text` at full weight.
   *
   * `derived` variants are a substitution the person did not type, and the
   * ranker holds them to WORD-shaped matches only. Letting a guessed word
   * match a fragment compounds two leaps into nonsense: expanding "logout" to
   * "sign" and then finding that inside "de-SIGN-er" ranked the storefront
   * editor above the sign-out link, which is exactly the kind of result that
   * makes people stop trusting a search box.
   *
   * `mask` is the variant's letter set, carried here so the ranker's typo
   * pass can reject a hopeless comparison without running one.
   */
  variants: readonly {
    text: string;
    weight: number;
    derived: boolean;
    mask: number;
  }[];
  /** True for filler: scores when it matches, never counts against a result
   *  that lacks it. */
  soft: boolean;
};

/** The whole query, prepared once per keystroke and reused across every entry. */
export type PreparedQuery = {
  /** The full folded, canonically-spelled query, single-spaced. Used for the
   *  phrase bonus, which is what keeps an exact synonym hit unbeatable. */
  phrase: string;
  /** Every token, soft ones included. */
  tokens: readonly QueryToken[];
  /** How many tokens must be accounted for. Zero means the query was empty. */
  required: number;
};

const ALIAS_WEIGHT = 0.92;
const STEM_WEIGHT = 0.97;

/**
 * A crude singular, used only as an extra thing to try.
 *
 * Fuzzy matching already covers most plurals ("colors" is one edit from
 * "color"), but not for short words, where the edit budget is zero on
 * purpose: "tabs" would never reach "tab". Wrong stems are harmless here,
 * since a stem that matches nothing costs nothing.
 */
function stem(word: string): string | null {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && (word.endsWith("ses") || word.endsWith("xes"))) {
    return word.slice(0, -2);
  }
  // Three, not four, so "bgs" reaches "bg" and through it "background".
  if (word.length >= 3 && word.endsWith("s") && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  return null;
}

function buildToken(word: string): QueryToken {
  const variants: QueryToken["variants"][number][] = [
    { text: word, weight: 1, derived: false, mask: charMask(word) },
  ];
  const seen = new Set([word]);

  const add = (text: string, weight: number) => {
    const value = canonical(text);
    if (!value || seen.has(value)) return;
    seen.add(value);
    variants.push({ text: value, weight, derived: true, mask: charMask(value) });
  };

  for (const alias of ALIASES[word] ?? []) add(alias, ALIAS_WEIGHT);
  const singular = stem(word);
  if (singular) {
    add(singular, STEM_WEIGHT);
    // "bgs" should reach background too, so the stem's own aliases count.
    for (const alias of ALIASES[singular] ?? []) add(alias, ALIAS_WEIGHT * STEM_WEIGHT);
  }

  return { text: word, variants, soft: SOFT_WORDS.has(word) };
}

/**
 * Turn a raw query into the thing the ranker scores against.
 *
 * The all-soft case matters more than it looks: someone typing "how do I" has
 * given nothing to narrow by, and treating every token as optional would score
 * the entire index at zero and show nothing. Promoting them all back to
 * required at least answers with whatever literally contains those words.
 */
export function prepareQuery(query: string): PreparedQuery {
  let words = normalizeWords(query);
  if (words.length === 0) {
    // Punctuation-only, and there is exactly one that matters: "@" is a
    // registered synonym for the username field. Fall back to the folded text
    // as a single literal token rather than answering an empty index.
    const literal = fold(query);
    if (!literal) return { phrase: "", tokens: [], required: 0 };
    words = [literal];
  }

  let tokens = words.map(buildToken);
  if (tokens.every((token) => token.soft)) {
    tokens = tokens.map((token) => ({ ...token, soft: false }));
  }

  return {
    phrase: words.join(" "),
    tokens,
    required: tokens.filter((token) => !token.soft).length,
  };
}
