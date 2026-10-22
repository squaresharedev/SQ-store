// What the automatic check does about seller text that tries to steer it.
//
// THE MODEL IS NOT THE ONLY DEFENCE. The policy tells it that content is data
// and that content addressing it is a reason to answer "unsure", and the fence
// it reads the content in cannot be forged (fenceSafe in classify.ts). Both
// rest on the model following an instruction. This file adds the parts that do
// not: what the model is shown is normalised so hidden or disguised text reads
// as what it is, and a line that plainly tries to address the check, or
// carries characters only a write around the app could put there, is held for
// a person without the model being asked at all. Same principle as
// isHotlinkedFileLine: a rule the check leans on must not be a coin the model
// flips differently from one run to the next.
//
// Pure: no I/O. classify.ts is the caller. Which characters count as hidden is
// decided once, in lib/validation/hidden-characters.ts.

export { hasHiddenCharacters } from "@/lib/validation/hidden-characters";

/** Invisible format characters (zero-width spaces and joiners, soft hyphens,
 *  direction marks and controls, tags) and variation selectors. Removed from
 *  what the model reads: they can split a word so it is not recognised. */
const INVISIBLE = /[\p{Cf}\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;

/**
 * The text as the classifier is shown it: compatibility forms folded (NFKC
 * turns fullwidth letters, ligatures and other look-alike forms into plain
 * ones) and invisible characters removed, so a word disguised with them reads
 * as the word. Only the model's copy: the stored row, and the hash approvals
 * are kept under, are untouched.
 */
export function normalizeForModel(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE, "");
}

/** Anything that is not a letter or a digit, in any script. */
const SEP = "[^\\p{L}\\p{N}]+";
/** A separator that may be missing ("SquareShare", "preapproved"). Grouped:
 *  a bare `?` after SEP's `+` would make it lazy, not optional. */
const OPT_SEP = `(?:${SEP})?`;
/** The start of a word, in any script. */
const W = "(?<![\\p{L}\\p{N}])";

const pattern = (source: string) => new RegExp(source, "iu");

/**
 * Text that addresses an automated check instead of describing a product.
 * Deliberately narrow: each one is something an ordinary listing has no reason
 * to say, so a seller writing normally is never held by it. Words that do
 * appear in listings ("clean", "safe", "instructions included", "system",
 * "approved") only count in the phrasing that steers a check. Matched against
 * normalizeForModel's output.
 */
const ADDRESSES_THE_CHECK: readonly RegExp[] = [
  // "Ignore all previous instructions", in the languages the platform serves.
  pattern(`${W}(ignore|disregard|forget|override|bypass)${SEP}(all${SEP})?(of${SEP})?(the${SEP})?(previous|prior|above|earlier|preceding|system|your|these)${SEP}(instructions?|prompts?|rules|guidelines|directives?|policy)`),
  pattern(`${W}(ignoriere|ignorieren|vergiss|vergessen)${SEP}(alle${SEP})?(vorherigen|bisherigen|obigen|deine)${SEP}(anweisungen|regeln|vorgaben)`),
  pattern(`${W}(ignoruj|ignorujte|zapomeň)${SEP}(všechny${SEP})?(předchozí|výše${SEP}uvedené|své)${SEP}(instrukce|pokyny|pravidla)`),
  pattern(`${W}(ignoruj|ignorujte|zabudni)${SEP}(všetky${SEP})?(predchádzajúce|vyššie${SEP}uvedené|svoje)${SEP}(inštrukcie|pokyny|pravidlá)`),
  pattern(`${W}(zignoruj|ignoruj|zapomnij)${SEP}(wszystkie${SEP})?(poprzednie|wcześniejsze|powyższe)${SEP}(instrukcje|polecenia|zasady)`),
  pattern(`${W}(ignore[zr]?|oublie[zr]?)${SEP}(toutes${SEP})?(les${SEP})?(instructions|consignes|règles)${SEP}(précédentes|ci${SEP}dessus)`),
  pattern(`${W}(ignora|ignore|olvida)\\p{L}*${SEP}(todas${SEP})?(las${SEP})?(instrucciones|reglas)${SEP}(anteriores|previas)`),
  pattern(`${W}(ignora|dimentica)\\p{L}*${SEP}(tutte${SEP})?(le${SEP})?(istruzioni|regole)${SEP}(precedenti)`),
  pattern(`${W}(negeer|vergeet)${SEP}(alle${SEP})?(vorige|eerdere|bovenstaande)${SEP}(instructies|regels)`),
  pattern(`${W}(ignor[ae]|esquece)\\p{L}*${SEP}(todas${SEP})?(as${SEP})?(instruções|regras)${SEP}(anteriores)`),
  // Talking about the check's own instructions or role. ("Developer" and a
  // bare "System:" are left out on purpose: film developer instructions and
  // "System: Android 14" are ordinary listings.)
  pattern(`${W}system${SEP}prompt`),
  pattern(`${W}you${SEP}are${SEP}(now${SEP})?(an?${SEP}|the${SEP})?(ai|assistant|chatbot|language${SEP}model|llm|classifier|moderator|content${SEP}(check|checker|moderator|filter|classifier))(?![\\p{L}\\p{N}])`),
  pattern(`${W}(act|behave|respond)${SEP}as${SEP}(an?${SEP}|the${SEP})?(ai|assistant|classifier|moderator|content${SEP}(check|moderator))(?![\\p{L}\\p{N}])`),
  // Asking for a particular verdict: the verdict word in quotes after a verb
  // that answers, or "mark/classify it as". A bare "answer: clean lines" or
  // "leaves no mark, clean finish" is copy, not a request.
  pattern(`${W}(answer|respond|reply|return|output|say)${SEP}(with${SEP})?["'“”‘’«»„]\\s*(clean|approved)\\s*["'“”‘’«»“]`),
  pattern(`${W}(classify|mark|label)${SEP}(this|it|the${SEP}(listing|content|product))${SEP}(as${SEP})?(clean|approved|safe${SEP}to${SEP}publish)(?![\\p{L}\\p{N}])`),
  // A note addressed to whoever (or whatever) reviews the listing.
  pattern(`${W}(note|message)${SEP}(to|for)${SEP}(the${SEP})?(moderators?|reviewers?|checker|ai|classifier|bot)(?![\\p{L}\\p{N}])`),
  pattern(`${W}dear${SEP}(moderators?|reviewers?|checker|ai|classifier|bot)(?![\\p{L}\\p{N}])`),
  pattern(`${W}verdict${SEP}(is${SEP}|should${SEP}be${SEP}|must${SEP}be${SEP})?["'“‘]?(clean|unsure|violation)(?![\\p{L}\\p{N}])`),
  pattern(`"verdict"\\s*:`),
  // Claiming the platform already approved it.
  pattern(`${W}(pre${OPT_SEP})?(approved|verified|cleared|whitelisted)${SEP}by${SEP}(square${OPT_SEP}share|(the${SEP})?(moderators?|moderation${SEP}team))(?![\\p{L}\\p{N}])`),
  pattern(`${W}square${OPT_SEP}share${SEP}(staff|team|moderators?|moderation|admins?)${SEP}(has${SEP}|have${SEP})?(approved|verified|cleared)`),
  // Markup and chat-template tokens that try to open a new role or close the
  // fence. (Markdown headings like "## System requirements" are copy.)
  pattern(`<\\s*/?\\s*(content|system|instructions?|assistant|policy)(\\s[^>]*)?>`),
  pattern(`<\\|\\s*im_(start|end)\\s*\\|>|\\[\\s*/?\\s*inst\\s*\\]`),
];

/** Whether a value plainly tries to address the automated check. */
export function addressesTheCheck(value: string): boolean {
  const text = normalizeForModel(value);
  return ADDRESSES_THE_CHECK.some((rule) => rule.test(text));
}
