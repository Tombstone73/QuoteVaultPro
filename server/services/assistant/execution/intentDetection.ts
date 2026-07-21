/** Detect only that a message seeks a mutation. It never selects a command. */
const mutationPattern = /\b(add|adjust|approve|archive|cancel|change|create|deactivate|delete|edit|enable|mark|move|remove|rename|save|set|update)\b/i;
const explicitConfirmationPattern = /^\s*go\s*[!.]?\s*$/i;

export function hasMutationIntent(message: string): boolean {
  return mutationPattern.test(message);
}

/** Free-text GO is deliberately not confirmation and must remain a normal message. */
export function isFreeTextGo(message: string): boolean {
  return explicitConfirmationPattern.test(message);
}
