import { SIZE_PRESET } from "./option-presets";

// Common sense about options, with no data behind it: what a product is sold
// in, read from its title, and what comes next in a list a seller is typing.
// A guess is only made when it is close to certain; anything else returns
// nothing and the form behaves as if this file did not exist. Words are
// matched in every language sellers write in, whatever language the app is in.

/** A title lowered to plain words: no accents, no punctuation ("T-Shirt" is
 *  "t", "shirt"). */
function words(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/ł/g, "l")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A space-separated word list as a set. */
const wordSet = (...lines: string[]) => new Set(lines.flatMap((line) => line.split(" ")));

/** Clothes sold in S, M, L. A word that also means something else in another
 *  language ("tee" is tea in German, "pull" a drawer handle) is left out. */
const CLOTHES = wordSet(
  // English
  "tshirt tshirts shirt shirts sweater sweaters sweatshirt sweatshirts hoodie hoodies hoody jumper jumpers",
  "pullover pullovers cardigan cardigans jacket jackets coat coats dress dresses skirt skirts jeans trousers",
  "pants shorts leggings blouse blouses joggers sweatpants tracksuit onesie romper bodysuit pyjamas pajamas",
  "swimsuit bikini tunic blazer parka anorak gilet waistcoat vest vests overalls dungarees camisole longsleeve",
  // German
  "kleid kleider jacke jacken mantel bluse weste sakko pulli trainingsanzug schlafanzug badeanzug",
  // French
  "chemise chemisier veste manteau robe jupe pantalon debardeur doudoune blouson pyjama maillot survetement",
  // Spanish
  "camiseta camisetas camisa sudadera chaqueta abrigo vestido falda vaqueros pantalones blusa chandal pijama",
  "chaleco cazadora banador",
  // Italian
  "maglietta magliette camicia felpa maglione giacca cappotto vestito gonna pantaloni pantaloncini camicetta",
  "pigiama giubbotto piumino canotta",
  // Dutch
  "jas jasje colbert vestje badpak trainingspak",
  // Polish
  "koszulka koszulki koszula bluza bluzka sweter kurtka plaszcz sukienka spodnica spodnie szorty legginsy",
  "dres pizama kamizelka marynarka jeansy",
  // Portuguese
  "camisola casaco saia calcas calcoes colete blusao",
  // Czech and Slovak
  "tricko tricka kosile kosela mikina mikiny svetr sveter bunda kabat saty sukne sukna kalhoty nohavice",
  "sortky leginy halenka teplaky pyzamo vesta sako dziny",
);

/** Footwear, sized in numbers that differ by country, so its sizes are the
 *  seller's own to type. */
const SHOES = wordSet(
  "shoe shoes sneaker sneakers trainers boots sandal sandals slippers loafers heels",
  "schuh schuhe stiefel sandalen chaussures bottes sandales chaussons zapatos zapatillas botas sandalias",
  "scarpe stivali sandali ciabatte schoenen laarzen pantoffels buty trampki sandaly kapcie sapatos",
  "sapatilhas boty tenisky topanky cizmy sandale",
);

/** Endings that make a garment or a shoe in languages that join words
 *  (Regenjacke, Sommerkleid, Spijkerbroek, Hausschuhe), long enough not to end
 *  an unrelated word by accident. */
const CLOTHES_ENDINGS = ["shirt", "jacke", "kleid", "hemd", "hose", "pullover", "broek", "jurk", "trui"];
const SHOE_ENDINGS = ["schuhe", "schoenen", "stiefel"];

/** Children's sizes run on ages and heights, not S to XL. */
const CHILDREN = wordSet(
  "baby babies kid kids child children toddler infant newborn girl girls boy boys kinder kinderen bebe",
  "enfant enfants nino nina ninos infantil bambino bambina bambini neonato dzieci dzieciecy dziecko",
  "niemowle crianca criancas detske detsky detska kojenecke",
);

/** Words that make a title about something other than a garment: a hanger, a
 *  sewing pattern, a print file, a doll's dress, an iron-on patch, jumper
 *  cables. Any one of them and no guess is made. */
const NOT_WORN = wordSet(
  "hanger hangers rack racks pattern patterns template templates svg png pdf dxf mockup mockups",
  "sticker stickers decal decals poster posters card cards mug mugs keychain keyring ornament ornaments",
  "magnet magnets patch patches doll dolls fabric yarn kit kits digital download file files bag bags",
  "labels polish laces insole insoles cleaner cable cables",
  "muster schnittmuster aufnaher puppe patron cintre poupee percha muneca cartamodello gruccia bambola",
  "patroon wykroj wieszak lalka molde cabide boneca strih raminko panenka vesiak babika",
);

/** Pairs that name a thing that is not worn, though each word alone could be. */
const NOT_WORN_PAIRS = [
  "tree skirt",
  "bed skirt",
  "table skirt",
  "coat hook",
  "coat of arms",
  "dress form",
  "book jacket",
  "dust jacket",
];

const isOrEnds = (word: string, set: ReadonlySet<string>, endings: readonly string[]) =>
  set.has(word) || endings.some((ending) => word.length > ending.length && word.endsWith(ending));

/**
 * The sizes a product is likely sold in, from its title: XS to XXL for
 * clothes, an empty list (sizes, but the seller's own) for shoes and
 * children's clothes, or null when the title does not make it clear.
 * "Organic cotton T-shirt" is clothes; "T-shirt sewing pattern" is not.
 */
export function guessSizes(title: string): readonly string[] | null {
  const found = words(title);
  const phrase = ` ${found.join(" ")} `;
  if (found.some((word) => NOT_WORN.has(word)) || NOT_WORN_PAIRS.some((pair) => phrase.includes(` ${pair} `))) {
    return null;
  }
  if (found.some((word) => isOrEnds(word, SHOES, SHOE_ENDINGS))) return [];
  if (!found.some((word) => isOrEnds(word, CLOTHES, CLOTHES_ENDINGS))) return null;
  // The Size button's own values, so a guess adds exactly what it would.
  return found.some((word) => CHILDREN.has(word)) ? [] : SIZE_PRESET.values;
}

/** Sizes in the order they climb. Matched without case; a suggestion takes
 *  the case of what the seller typed. Words are given per language because a
 *  seller writes "Klein, Mittel" in one language, not a mix. */
const LADDERS: readonly (readonly string[])[] = [
  ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL"],
  ["A6", "A5", "A4", "A3", "A2", "A1", "A0"],
  ["Small", "Medium", "Large", "Extra large"],
  ["Klein", "Mittel", "Groß"],
  ["Petit", "Moyen", "Grand"],
  ["Pequeño", "Mediano", "Grande"],
  ["Piccolo", "Medio", "Grande"],
  ["Klein", "Middel", "Groot"],
  ["Mały", "Średni", "Duży"],
  ["Pequeno", "Médio", "Grande"],
  ["Malá", "Střední", "Velká"],
  ["Malá", "Stredná", "Veľká"],
];

/** How many next values are offered at once. */
const NEXT_MAX = 3;

/** `word` written the way `sample` is: all capitals, all small, or as given. */
function matchCase(sample: string, word: string): string {
  if (sample.length > 1 && sample === sample.toUpperCase()) return word.toUpperCase();
  if (sample === sample.toLowerCase()) return word.toLowerCase();
  return word;
}

/** Where each name sits on the one ladder they are all on, or null when they
 *  fit none or several ("Grande" alone is Spanish, Italian or Portuguese). */
function ladderFor(names: readonly string[]): { ladder: readonly string[]; steps: number[] } | null {
  const fits = LADDERS.flatMap((ladder) => {
    const lower = ladder.map((step) => step.toLowerCase());
    const steps = names.map((name) => lower.indexOf(name.toLowerCase()));
    return steps.every((step) => step !== -1) ? [{ ladder, steps }] : [];
  });
  return fits.length === 1 ? fits[0]! : null;
}

/** A number with an optional unit after it ("250 ml", "38", "1.5 l"). */
const MEASURE = /^(\d+(?:\.\d+)?)(\s*)(\D*)$/;

/** The next two of an even run of numbers ("38, 39" to 40, 41; "250 ml,
 *  500 ml" to 750 ml, 1000 ml): at least two, one unit, one rising step. */
function nextInRun(names: readonly string[]): string[] {
  const parsed = names.map((name) => MEASURE.exec(name));
  if (parsed.length < 2 || parsed.some((match) => !match)) return [];
  const runs = parsed as RegExpExecArray[];
  const unit = runs[0]![3]!.toLowerCase();
  if (runs.some((match) => match[3]!.toLowerCase() !== unit)) return [];
  const values = runs.map((match) => Number(match[1]));
  const step = values[1]! - values[0]!;
  const even = values.every((value, index) => index === 0 || Math.abs(value - values[index - 1]! - step) < 1e-9);
  if (!even || step <= 0) return [];
  const decimals = Math.max(...runs.map((match) => match[1]!.split(".")[1]?.length ?? 0));
  const last = runs[runs.length - 1]!;
  const lastValue = values[values.length - 1]!;
  return [1, 2].map((n) => `${Number((lastValue + step * n).toFixed(decimals))}${last[2]}${last[3]}`);
}

/**
 * What a seller is likely to add next to a list of options: the neighbours of
 * what they have on a size ladder ("Small" offers Medium and Large, "S" offers
 * XS, M and L), or the next two of an even run of numbers. Nothing when the
 * list fits no pattern for sure, and never a value the list already has.
 */
export function nextOptionValues(names: readonly string[]): string[] {
  const named = names.map((name) => name.trim()).filter(Boolean);
  if (named.length === 0) return [];
  const fit = ladderFor(named);
  if (!fit) return nextInRun(named);
  const { ladder, steps } = fit;
  const low = Math.min(...steps);
  const high = Math.max(...steps);
  // Gaps first, then the nearest above and below, a step up winning a tie.
  const distance = (step: number) => (step < high && step > low ? 0 : step > high ? step - high : low - step + 0.5);
  const sample = named[named.length - 1]!;
  return ladder
    .map((_, step) => step)
    .filter((step) => !steps.includes(step))
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, NEXT_MAX)
    .sort((a, b) => a - b)
    .map((step) => matchCase(sample, ladder[step]!));
}
