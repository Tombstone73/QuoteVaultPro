import { describe, test, expect } from "@jest/globals";
import { buildSymbolTable } from "../symbolTable";

describe("pbv2/symbolTable", () => {
  test("indexes INPUT nodes by selectionKey and COMPUTE outputs by nodeId", () => {
    const treeVersion = {
      nodes: [
        {
          id: "n_input_qty",
          type: "INPUT",
          input: { selectionKey: "qty", valueType: "NUMBER", defaultValue: 1 },
        },
        {
          id: "n_compute_total",
          type: "COMPUTE",
          compute: { outputs: { total: { type: "NUMBER" } } },
        },
      ],
    };

    const { table, findings } = buildSymbolTable(treeVersion);
    expect(findings).toHaveLength(0);

    expect(table.inputBySelectionKey.qty).toBeTruthy();
    expect(table.inputBySelectionKey.qty.nodeId).toBe("n_input_qty");
    expect(table.inputBySelectionKey.qty.inputKind).toBe("NUMBER");
    expect(table.inputBySelectionKey.qty.hasDefault).toBe(true);

    expect(table.computeByNodeId.n_compute_total).toBeTruthy();
    expect(table.computeByNodeId.n_compute_total.outputs.total.type).toBe("NUMBER");
  });
});
