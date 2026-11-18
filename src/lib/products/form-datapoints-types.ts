import type { MessageRef } from "@/i18n/types";

/**
 * The key fragment that covers Products.* message keys, isolated here so that
 * the client bundle never sees the template-literal type. form-datapoints.ts
 * imports this with `import type`, which the bundle-graph test strips before
 * walking the client closure; the literal `Products.${string}` therefore never
 * appears in the client bundle and cannot force the entire Products namespace
 * into a scope.
 */
export type ProductsKey = Extract<MessageRef["key"], `Products.${string}`>;
