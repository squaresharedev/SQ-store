import type { Listing } from "@/lib/suggestions/listing";

/**
 * What the live evals of the listing tasks (describe-listing.live,
 * complete-listing.live) look for in a model's answer: claim words a careless
 * writer adds, words of the language it must be in, and the arithmetic of a
 * run (time and cost per call).
 */

// What a careless writer adds, per language. A match is only a failure when
// the listing itself does not say it.
export const CLAIMS: Record<string, RegExp> = {
  en: /handmade|hand-made|handcrafted|artisan|eco|sustainab|organic|\bnatural|non-toxic|biodegradable|recycl|vegan|cruelty|fair trade|guarantee|warrant|certif|award|ships|shipping|delivery|order now|limited|only \d|the best|finest|premium|genuine|hypoallergenic|healthy|soft|sturdy|breathable|elegant|cozy|cosy|durable|timeless|one of a kind|unique|nourishing|luxurious/i,
  de: /handgemacht|handgefertigt|nachhaltig|öko|\bbio|natürlich|umweltfreundlich|garantie|zertifi|versand|lieferung|\bbeste|hochwertig|weich|robust|elegant|gemütlich|langlebig|einzigartig/i,
  fr: /fait main|artisanal|écolo|durable|naturel|\bbio|garanti|certifi|livraison|meilleur|haut de gamme|robuste|élégant|unique/i,
  es: /hecho a mano|artesanal|sostenible|ecológ|natural|garant|certific|envío|\bmejor|premium|suave|resistente|elegante|únic/i,
  it: /fatto a mano|artigian|sostenibil|ecolog|natural|garanzi|certific|spedizion|miglior|pregiat|morbid|robust|elegant|unic/i,
  nl: /handgemaakt|duurzaam|ecologisch|natuurlijk|biologisch|garantie|gecertificeerd|verzend|levering|\bbeste|zacht|stevig|elegant|uniek/i,
  cs: /ručně|udržiteln|ekolog|přírodní|\bbio|záruk|certifik|doprav|nejlepší|prvotřídní|měkk|odoln|elegantn|jedinečn/i,
  pl: /ręcznie|zrównoważ|ekolog|naturaln|gwarancj|certyfik|wysyłk|dostaw|najlepsz|miękk|wytrzymał|elegancki|wyjątkow/i,
  pt: /feito à mão|artesanal|sustentáv|ecológ|natural|garantia|certific|envio|entrega|melhor|macio|resistente|elegante|únic/i,
  sk: /ručne|udržateľn|ekolog|prírodn|\bbio|záruk|certifik|doprav|najlepš|mäkk|odoln|elegantn|jedinečn/i,
};

/** Everyday words of the language an answer must be in. */
export const IN: Record<string, RegExp> = {
  en: /\b(the|and|with|for|is|of|it|made|from)\b/i,
  de: /\b(der|das|und|ein|eine|mit|für|aus|ist)\b/i,
  nl: /\b(het|een|van|voor|met|deze|je)\b/i,
};

/** Everything the listing says, as one string to search. */
export function listingText(listing: Pick<Listing, "title" | "text" | "facts">): string {
  return [listing.title, listing.text, ...listing.facts.map((fact) => `${fact.label} ${fact.value}`)].join(" ");
}

/** The claim words in `answer` that the listing never used. */
export function inventedClaims(answer: string, listing: Pick<Listing, "title" | "text" | "facts">, claims: RegExp): string[] {
  const global = new RegExp(claims.source, `${claims.flags.replace("g", "")}g`);
  const source = listingText(listing).toLowerCase();
  return [...new Set([...answer.matchAll(global)].map((match) => match[0].toLowerCase()))].filter(
    (word) => !source.includes(word),
  );
}

/** A run's time and cost per call, as the summary line of an eval. */
export function runSummary(calls: readonly { ms: number; cost: number }[]): string {
  const sorted = calls.map((call) => call.ms).sort((a, b) => a - b);
  const dollars = calls.reduce((sum, call) => sum + call.cost, 0) / 1_000_000;
  return [
    `latency median ${sorted[Math.floor(sorted.length / 2)]} ms, p90 ${sorted[Math.floor(sorted.length * 0.9)]} ms, max ${sorted.at(-1)} ms`,
    `$${(dollars / Math.max(1, calls.length)).toFixed(6)} a call, $${dollars.toFixed(4)} the run`,
  ].join("\n");
}
