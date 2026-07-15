import { renderToStaticMarkup } from "react-dom/server";
import { QuoteListNote } from "./quote-list-note";

describe("QuoteListNote", () => {
  test("clamps long notes to three lines while preserving accessible full text", () => {
    const note = "A very long internal list note with source-like content and an_unusually_long_identifier_that_must_not_expand_the_quotes_table";
    const html = renderToStaticMarkup(<QuoteListNote note={note} onEdit={() => undefined} />);

    expect(html).toContain("line-clamp-3");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain(`title="${note}"`);
    expect(html).toContain(`aria-label="Edit list note. Full note: ${note}"`);
    expect(html).toContain("<button");
  });
});
