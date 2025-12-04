/**
 * Storage Layer Facade
 * 
 * This file provides backward compatibility for existing code that imports from "./storage".
 * It re-exports everything from the new modular storage layer located in ./storage/index.ts
 * 
 * The refactored storage layer is organized into domain-specific repositories:
 * - audit.repo.ts - Audit log operations
 * - accounting.repo.ts - Vendors and purchase orders
 * - inventory.repo.ts - Materials and inventory management
 * - jobs.repo.ts - Production jobs and job statuses
 * - shared.repo.ts - Users, products, settings, and shared resources
 * - customers.repo.ts - Customers, contacts, notes, and credit transactions
 * - quotes.repo.ts - Quotes and quote line items
 * - orders.repo.ts - Orders, line items, shipments, and attachments
 * 
 * All original method signatures and behavior are preserved for 100% backward compatibility.
 */

// Re-export everything from the new modular storage layer
export * from "./storage/index";

// Also export the storage object for code that uses storage.method() syntax
import { storage } from "./storage/index";
export { storage };
