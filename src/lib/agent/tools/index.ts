import { analyticsTools } from "@/lib/agent/tools/analytics";
import { discountTools } from "@/lib/agent/tools/discounts";
import { moderationTools } from "@/lib/agent/tools/moderation";
import { notificationTools } from "@/lib/agent/tools/notifications";
import { orderTools } from "@/lib/agent/tools/orders";
import { productTools } from "@/lib/agent/tools/products";
import { reviewTools } from "@/lib/agent/tools/reviews";
import { storefrontTools } from "@/lib/agent/tools/storefronts";
import { storeTools } from "@/lib/agent/tools/store";
import type { AgentTool } from "@/lib/agent/tool";

/** Every tool, in the order a client lists them: orientation first. */
export const AGENT_TOOLS: readonly AgentTool[] = [
  ...storeTools,
  ...productTools,
  ...storefrontTools,
  ...orderTools,
  ...discountTools,
  ...reviewTools,
  ...analyticsTools,
  ...notificationTools,
  ...moderationTools,
];

const BY_NAME = new Map(AGENT_TOOLS.map((tool) => [tool.name, tool]));

export function findTool(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}
