import { discountCheckResponse } from "@/lib/checkout/discount-check";

/**
 * POST /api/checkout/[storefrontId]/discount: a cart's checkout "Apply" for a
 * discount code. The body names the cart's products; the answer says which of
 * them the code covers. Every rule is lib/checkout/discount-check.ts.
 */

type Params = { storefrontId: string };

export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  const { storefrontId } = await params;
  return discountCheckResponse(request, storefrontId, (productIds) => [...productIds]);
}
