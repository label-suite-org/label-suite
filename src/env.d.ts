/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    requestId: string;
    user?: {
      id: string;
      name?: string | null;
      email?: string | null;
    };
    session?: unknown;
    orgId?: string;
    org?: {
      id: string;
      name: string;
      slug: string;
      plan: string | null;
    };
    membershipRole?: "owner" | "operator" | "fundraiser" | "member" | "payee";
  }
}
