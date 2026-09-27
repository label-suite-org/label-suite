import { createContext, useContext } from "react";
import type { Capability, MembershipRole } from "../server/tenant";

export type ClientCapabilityMap = Record<Capability, boolean>;
export type ClientAccess = { role: MembershipRole; capabilities: ClientCapabilityMap };

export const ClientAccessContext = createContext<ClientAccess | null>(null);

export function useClientAccess(): ClientAccess | null {
  return useContext(ClientAccessContext);
}
