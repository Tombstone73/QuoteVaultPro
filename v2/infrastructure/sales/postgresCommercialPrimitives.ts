import type { TransactionalClient } from "../persistence/types.js";
import type { SalesDocumentKind, SalesDocumentNumber } from "../../src/modules/sales/persistenceContracts.js";

const documentPrefix: Readonly<Record<SalesDocumentKind, string>> = Object.freeze({ quote: "QT", order: "ORD" });

/**
 * Sales-owned number allocation only. It is intentionally not a document
 * writer: M1.7 will call it inside its own Sales transaction before inserting
 * a header. The single UPSERT is safe under concurrent callers and rolls back
 * with a caller-owned transaction.
 */
export class PostgresSalesDocumentNumberAllocator {
  async allocate(client: TransactionalClient, organizationId: string, kind: SalesDocumentKind): Promise<SalesDocumentNumber> {
    const result = await client.query<{ allocated_core: string }>(
      `INSERT INTO v2_sales_document_number_counters (organization_id, document_kind, next_number)
       VALUES ($1, $2, 1001)
       ON CONFLICT (organization_id, document_kind)
       DO UPDATE SET next_number = v2_sales_document_number_counters.next_number + 1, updated_at = now()
       RETURNING next_number - 1 AS allocated_core`,
      [organizationId, kind],
    );
    const core = BigInt(result.rows[0]?.allocated_core ?? "0");
    if (core < 1000n) throw new Error("Sales document numbering returned an invalid core number.");
    return Object.freeze({ kind, core, display: `${documentPrefix[kind]}-${core.toString()}` });
  }
}
