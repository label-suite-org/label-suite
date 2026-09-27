import { PermanentSyncError } from "./errors.js";
import {
  HEALTH_ITEM_NAME,
  PlaneClient,
  type PlaneModuleMembershipInventory,
  type PlaneWorkItem,
} from "./plane.js";
import { SqliteDeliveryStore } from "./store.js";
import type { BootstrapReport, PlaneVocabulary } from "./types.js";

const HEALTH_ITEM_ID_KEY = "health-item-id";
const HEALTH_ITEM_CANDIDATE_ID_KEY = "health-item-candidate-id";
const LAST_PLANE_MUTATION_KEY = "last-successful-plane-mutation-at";

interface BootstrapDeps {
  store: SqliteDeliveryStore;
  plane: PlaneClient;
}

interface BootstrapOptions {
  apply: boolean;
  now?: Date;
}

function mutationAt(options: BootstrapOptions): string {
  return new Date(options.now ?? new Date()).toISOString();
}

function recordPlaneMutation(deps: BootstrapDeps, options: BootstrapOptions): void {
  deps.store.setMaxTimestamp(LAST_PLANE_MUTATION_KEY, mutationAt(options));
}

function validateIdentity(item: PlaneWorkItem): void {
  if (item.name !== HEALTH_ITEM_NAME) throw new PermanentSyncError("plane_health_item_invalid");
}

function validateConverged(
  item: PlaneWorkItem,
  vocabulary: PlaneVocabulary,
  inventory: PlaneModuleMembershipInventory | null,
): void {
  validateIdentity(item);
  const productModuleId = vocabulary.modules["Product Confidence & Delivery"];
  if (item.stateId !== vocabulary.states.Todo) throw new PermanentSyncError("plane_health_item_invalid");
  if (inventory !== null
    ? !inventory.hasExactlyOneModule(item.id, productModuleId)
    : item.moduleIds.length !== 1 || item.moduleIds[0] !== productModuleId) {
    throw new PermanentSyncError("plane_health_item_invalid");
  }
}

async function membershipInventory(deps: BootstrapDeps): Promise<PlaneModuleMembershipInventory | null> {
  const load = (deps.plane as unknown as { loadModuleMembershipInventory?: () => Promise<PlaneModuleMembershipInventory> })
    .loadModuleMembershipInventory;
  return load ? load.call(deps.plane) : null;
}

async function convergeHealthItem(
  deps: BootstrapDeps,
  options: BootstrapOptions,
  vocabulary: PlaneVocabulary,
  inventory: PlaneModuleMembershipInventory | null,
  current: PlaneWorkItem,
): Promise<PlaneWorkItem> {
  validateIdentity(current);
  if (!options.apply) return current;
  const moduleId = vocabulary.modules["Product Confidence & Delivery"];
  if (current.stateId !== vocabulary.states.Todo) {
    current = await deps.plane.patchProjection(current, { stateId: vocabulary.states.Todo });
    recordPlaneMutation(deps, options);
  }
  const hasExactlyOneModule = inventory !== null
    ? inventory.hasExactlyOneModule(current.id, moduleId)
    : current.moduleIds.length === 1 && current.moduleIds[0] === moduleId;
  if (!hasExactlyOneModule) {
    await deps.plane.setModule(current.id, moduleId, () => recordPlaneMutation(deps, options), inventory ?? undefined);
  }
  const verified = await deps.plane.getWorkItem(current.id);
  validateConverged(verified, vocabulary, inventory);
  return verified;
}

export async function bootstrapPlane(
  deps: BootstrapDeps,
  options: BootstrapOptions,
): Promise<BootstrapReport> {
  const inventory = await membershipInventory(deps);
  const vocabulary = inventory?.vocabulary ?? await deps.plane.resolveVocabulary();
  const healthItems = await deps.plane.findHealthItems();
  if (healthItems.length > 1) throw new PermanentSyncError("plane_health_item_ambiguous");
  const storedId = deps.store.getCursor(HEALTH_ITEM_ID_KEY);
  const candidateId = deps.store.getCursor(HEALTH_ITEM_CANDIDATE_ID_KEY);
  const listed = healthItems[0] ?? null;
  if (listed !== null) {
    validateIdentity(listed);
    if ((storedId !== null && storedId !== listed.id) || (candidateId !== null && candidateId !== listed.id)) {
      throw new PermanentSyncError("plane_health_item_ambiguous");
    }
    if (options.apply && storedId === null && candidateId === null) {
      deps.store.setCursor(HEALTH_ITEM_CANDIDATE_ID_KEY, listed.id);
    }
  }

  let current = listed;
  let created = false;
  if (current === null) {
    const durableId = storedId ?? candidateId;
    if (durableId !== null) {
      current = await deps.plane.getWorkItem(durableId);
    } else if (!options.apply) {
      return { mode: "dry-run", healthItem: "would-create" };
    } else {
      const response = await deps.plane.createHealthItem({ stateId: vocabulary.states.Todo });
      recordPlaneMutation(deps, options);
      validateIdentity(response);
      deps.store.setCursor(HEALTH_ITEM_CANDIDATE_ID_KEY, response.id);
      current = await deps.plane.getWorkItem(response.id);
      created = true;
    }
  } else if (options.apply) {
    current = await deps.plane.getWorkItem(current.id);
  }

  const verified = await convergeHealthItem(deps, options, vocabulary, inventory, current);
  if (options.apply) {
    deps.store.setCursor(HEALTH_ITEM_ID_KEY, verified.id);
    deps.store.clearCursor(HEALTH_ITEM_CANDIDATE_ID_KEY);
  }
  return {
    mode: options.apply ? "active" : "dry-run",
    healthItem: created ? "created" : "present",
  };
}
