/** Every tenant-data repository method receives this explicit storage scope. */
export type OrganizationScope = Readonly<{ organizationId: string }>;

/** Add customer/resource constraints only where the repository needs them. */
export type CustomerScope = OrganizationScope & Readonly<{ customerId: string }>;
export type ResourceScope = OrganizationScope &
  Readonly<{ resourceType: string; resourceId: string }>;

export type PersistedRecord<TId extends string = string> = Readonly<{
  id: TId;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}>;

/**
 * Domain ports remain narrow and explicit. Implementations live in
 * infrastructure and must apply the supplied scope in their SQL predicates.
 */
export interface ScopedReader<TRecord extends PersistedRecord> {
  findById(scope: OrganizationScope, id: TRecord["id"]): Promise<TRecord | null>;
}

export interface ScopedWriter<TRecord extends PersistedRecord, TCreate> {
  create(scope: OrganizationScope, input: TCreate): Promise<TRecord>;
}
