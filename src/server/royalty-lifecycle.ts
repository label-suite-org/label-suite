export const royaltyLifecycleDefinitions = {
  import: {
    states: ["received", "parsing", "parsed", "failed", "superseded"],
    transitions: [["received", "parsing"], ["parsing", "parsed"], ["parsing", "failed"], ["parsed", "superseded"]],
  },
  calculationRun: {
    states: ["draft", "approved", "reversed"],
    transitions: [["draft", "approved"], ["approved", "reversed"]],
  },
  statement: {
    states: ["draft", "calculated", "reviewed", "issued", "closed"],
    transitions: [["draft", "calculated"], ["calculated", "reviewed"], ["reviewed", "issued"], ["issued", "closed"]],
  },
  payout: {
    states: ["draft", "approved", "recorded", "failed", "reversed"],
    transitions: [["draft", "approved"], ["approved", "recorded"], ["draft", "failed"], ["approved", "failed"], ["recorded", "reversed"]],
  },
  ledgerTransaction: {
    states: ["draft", "posted", "reversed"],
    transitions: [["draft", "posted"], ["posted", "reversed"]],
  },
} as const;

export type RoyaltyLifecycleEntity = keyof typeof royaltyLifecycleDefinitions;

function definitionFor(entity: string) {
  const definition = royaltyLifecycleDefinitions[entity as RoyaltyLifecycleEntity];
  if (!definition) {
    throw new Error(`Unknown royalty lifecycle entity: ${entity}`);
  }
  return definition;
}

function assertKnownState(entity: RoyaltyLifecycleEntity, state: string): void {
  if (!(royaltyLifecycleDefinitions[entity].states as readonly string[]).includes(state)) {
    throw new Error(`Unknown ${entity} lifecycle state: ${state}`);
  }
}

export function canTransitionRoyaltyLifecycle(entity: RoyaltyLifecycleEntity, from: string, to: string): boolean {
  const definition = definitionFor(entity);
  assertKnownState(entity, from);
  assertKnownState(entity, to);
  return definition.transitions.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to);
}

export function assertRoyaltyLifecycleTransition(entity: string, from: string, to: string): void {
  const definition = definitionFor(entity);
  const typedEntity = entity as RoyaltyLifecycleEntity;
  assertKnownState(typedEntity, from);
  assertKnownState(typedEntity, to);
  if (!definition.transitions.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to)) {
    throw new Error(`Invalid ${entity} lifecycle transition: ${from} -> ${to}`);
  }
}
