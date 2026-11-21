import { discountCheckResponse } from "@/lib/checkout/discount-check";

/**
 * POST /api/checkout/[storefrontId]/[productId]/discount: the "Buy now"
 * checkout's "Apply" for a discount code. The product in the path is the
 * order's first line; the body may name what was taken from its "Add to your
 * order", so the answer says which of them the code covers too. Every rule is
 * lib/checkout/discount-check.ts.
 */

type Params = { storefrontId: string; productId: string };

export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  const { storefrontId, productId } = await params;
  return discountCheckResponse(request, storefrontId, (more) => [productId, ...more]);
}
