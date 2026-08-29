import type { TransactionalClient } from "../persistence/types.js";
import type { SalesDocumentKind, SalesDocumentNumber } from "../../src/modules/sales/persistenceContracts.js";

/**
 * The shared Quote / Order-Job allocation primitive. Compatibility writers
 * invoke the same database function, while each document writer still owns
 * its own enclosing transaction and idempotency contract.
 */
export class PostgresSalesDocumentNumberAllocator {
  async allocate(client: TransactionalClient, organizationId: string, kind: SalesDocumentKind): Promise<SalesDocumentNumber> {
    const result = await client.query<{ allocated_core: string; display_prefix: string }>(
      "SELECT allocated_core::text, display_prefix FROM v2_allocate_sales_document_number($1,$2)",
      [organizationId, kind],
    );
    const core = BigInt(result.rows[0]?.allocated_core ?? "0");
    if (core < 1000n) throw new Error("Sales document numbering returned an invalid core number.");
    const prefix = String(result.rows[0]?.display_prefix ?? "");
    if (!/^[A-Za-z0-9_-]{0,16}$/u.test(prefix)) throw new Error("Sales document numbering returned an invalid display prefix.");
    return Object.freeze({ kind, core, display: `${prefix}${core.toString()}` });
  }
}
