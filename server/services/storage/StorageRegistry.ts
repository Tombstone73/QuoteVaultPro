import type { StorageProviderConfig } from "@shared/schema";
import { localFilesystemStorageAdapter } from "./adapters/LocalFilesystemStorageAdapter";
import { supabaseStorageAdapter } from "./adapters/SupabaseStorageAdapter";
import { titanManagedStorageAdapter } from "./adapters/TitanManagedStorageAdapter";
import type { StorageProviderAdapter } from "./adapters/StorageProviderAdapter";

export class StorageRegistry {
  private readonly adapters = new Map<StorageProviderConfig["providerType"], StorageProviderAdapter>([
    ["titan_managed", titanManagedStorageAdapter],
    ["supabase", supabaseStorageAdapter],
    ["local_filesystem", localFilesystemStorageAdapter],
  ]);

  getAdapter(providerType: StorageProviderConfig["providerType"]): StorageProviderAdapter {
    const adapter = this.adapters.get(providerType);
    if (!adapter) {
      throw new Error(`No storage adapter registered for provider type: ${providerType}`);
    }
    return adapter;
  }
}

export const storageRegistry = new StorageRegistry();
