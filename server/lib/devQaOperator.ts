import type { Capability } from "../../v2/src/authorization/capabilities";
import {
  DEV_QA_M78I_FIXTURE_ARTWORK_CAPABILITIES,
  DEV_QA_M78I_FIXTURE_ARTWORK_SET_DESCRIPTION,
  DEV_QA_M78I_FIXTURE_ARTWORK_SET_NAME,
  DEV_QA_M78I_FIXTURE_PRICING_CAPABILITIES,
  DEV_QA_M78I_FIXTURE_PRICING_SET_DESCRIPTION,
  DEV_QA_M78I_FIXTURE_PRICING_SET_NAME,
  DEV_QA_M78I_FIXTURE_ROUTE_CAPABILITIES,
  DEV_QA_M78I_FIXTURE_ROUTE_SET_DESCRIPTION,
  DEV_QA_M78I_FIXTURE_ROUTE_SET_NAME,
  DEV_QA_M78I_FIXTURE_SETUP_CAPABILITIES,
  DEV_QA_M78I_FIXTURE_SETUP_SET_DESCRIPTION,
  DEV_QA_M78I_FIXTURE_SETUP_SET_NAME,
  DEV_QA_M78I_OPERATIONAL_CAPABILITIES,
  DEV_QA_M78I_PERMISSION_FLOOR_CAPABILITIES,
  DEV_QA_M78I_PERMISSION_FLOOR_EMAIL,
  DEV_QA_M78I_PERMISSION_FLOOR_SET_NAME,
  DEV_QA_M78I_PERMISSION_SET_DESCRIPTION,
  DEV_QA_M78I_PERMISSION_SET_NAME,
} from "./devQaFullAccessProvisioning";
import {
  DEV_QA_OPERATOR_BROWSER_EMAIL,
  DEV_QA_OPERATOR_ORGANIZATION_ID,
  DEV_QA_OPERATOR_ORGANIZATION_NAME,
} from "./devQaProvisioningGuard";

export const DEV_QA_GUARDIAN_EMAIL = DEV_QA_M78I_PERMISSION_FLOOR_EMAIL;
export const DEV_QA_APPROVED_PROFILES = ["m78i", "m78i_fixture_pricing", "m78i_fixture_artwork", "m78i_fixture_route", "m78i_fixture_setup"] as const;
export type DevQaApprovedProfile = (typeof DEV_QA_APPROVED_PROFILES)[number];

export type DevQaProfileDefinition = Readonly<{
  name: DevQaApprovedProfile;
  permissionSetName: string;
  permissionSetDescription: string;
  capabilities: readonly Capability[];
}>;

const profileDefinitions: Record<DevQaApprovedProfile, DevQaProfileDefinition> = {
  m78i: Object.freeze({ name: "m78i", permissionSetName: DEV_QA_M78I_PERMISSION_SET_NAME, permissionSetDescription: DEV_QA_M78I_PERMISSION_SET_DESCRIPTION, capabilities: DEV_QA_M78I_OPERATIONAL_CAPABILITIES }),
  m78i_fixture_pricing: Object.freeze({ name: "m78i_fixture_pricing", permissionSetName: DEV_QA_M78I_FIXTURE_PRICING_SET_NAME, permissionSetDescription: DEV_QA_M78I_FIXTURE_PRICING_SET_DESCRIPTION, capabilities: DEV_QA_M78I_FIXTURE_PRICING_CAPABILITIES }),
  m78i_fixture_artwork: Object.freeze({ name: "m78i_fixture_artwork", permissionSetName: DEV_QA_M78I_FIXTURE_ARTWORK_SET_NAME, permissionSetDescription: DEV_QA_M78I_FIXTURE_ARTWORK_SET_DESCRIPTION, capabilities: DEV_QA_M78I_FIXTURE_ARTWORK_CAPABILITIES }),
  m78i_fixture_route: Object.freeze({ name: "m78i_fixture_route", permissionSetName: DEV_QA_M78I_FIXTURE_ROUTE_SET_NAME, permissionSetDescription: DEV_QA_M78I_FIXTURE_ROUTE_SET_DESCRIPTION, capabilities: DEV_QA_M78I_FIXTURE_ROUTE_CAPABILITIES }),
  m78i_fixture_setup: Object.freeze({ name: "m78i_fixture_setup", permissionSetName: DEV_QA_M78I_FIXTURE_SETUP_SET_NAME, permissionSetDescription: DEV_QA_M78I_FIXTURE_SETUP_SET_DESCRIPTION, capabilities: DEV_QA_M78I_FIXTURE_SETUP_CAPABILITIES }),
};

export function approvedDevQaProfile(value: string): DevQaApprovedProfile {
  if (!(DEV_QA_APPROVED_PROFILES as readonly string[]).includes(value)) {
    throw new Error("DEV QA operator accepts only m78i, m78i_fixture_pricing, m78i_fixture_artwork, m78i_fixture_route, or m78i_fixture_setup.");
  }
  return value as DevQaApprovedProfile;
}

export function devQaProfileDefinition(profile: DevQaApprovedProfile): DevQaProfileDefinition {
  return profileDefinitions[profile];
}

export function sameCapabilitySet(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  const normalizedRight = [...new Set(right)].sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

export function profileForPermissionState(permissionSetName: string | null, capabilities: readonly string[]): DevQaApprovedProfile | null {
  for (const profile of DEV_QA_APPROVED_PROFILES) {
    const definition = profileDefinitions[profile];
    if (definition.permissionSetName === permissionSetName && sameCapabilitySet(definition.capabilities, capabilities)) return profile;
  }
  return null;
}

export function assertDedicatedBrowserEmail(email: string | undefined): string {
  const normalized = email?.trim().toLowerCase();
  if (normalized !== DEV_QA_OPERATOR_BROWSER_EMAIL) {
    throw new Error("DEV QA operator is locked to the dedicated QA browser identity.");
  }
  return normalized;
}

export function assertDedicatedQaOrganization(id: string, name: string): void {
  if (id !== DEV_QA_OPERATOR_ORGANIZATION_ID || name !== DEV_QA_OPERATOR_ORGANIZATION_NAME) {
    throw new Error("DEV QA operator is locked to the dedicated PrintersHero M7 QA tenant.");
  }
}

export function isExactGuardianCapabilitySet(capabilities: readonly string[]): boolean {
  return sameCapabilitySet(capabilities, DEV_QA_M78I_PERMISSION_FLOOR_CAPABILITIES);
}

export function isTemporaryFixtureProfile(profile: DevQaApprovedProfile | null): boolean {
  return profile === "m78i_fixture_pricing" || profile === "m78i_fixture_artwork" || profile === "m78i_fixture_route" || profile === "m78i_fixture_setup";
}

export const DEV_QA_GUARDIAN_PERMISSION_SET_NAME = DEV_QA_M78I_PERMISSION_FLOOR_SET_NAME;
