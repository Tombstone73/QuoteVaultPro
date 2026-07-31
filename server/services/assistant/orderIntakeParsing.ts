export const isDirectOrderRequest = (message: string) => /\b(?:create|start|make|build)\b[\s\S]{0,50}\border\b/i.test(message);

export function directOrderRequestText(message: string, pendingRequest?: string | null): string | null {
  if (isDirectOrderRequest(message)) return message;
  return pendingRequest?.trim() ? `${pendingRequest}\n${message}` : null;
}

export const parseOrderQuantity = (message: string) => {
  const match = message.match(/\b(?:(\d+)\s*(?:qty|pieces?|units?|each)|(?:qty|quantity)\s*(\d+))\b/i);
  const quantity = Number(match?.[1] ?? match?.[2]);
  return Number.isInteger(quantity) && quantity > 0 ? quantity : null;
};
