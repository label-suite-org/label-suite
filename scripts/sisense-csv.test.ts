import { expect, it } from "vitest";
import { parseCsv } from "./sisense-csv";

it("preserves distinct playlist dimensions for null and quoted empty fields", () => {
  const csv = parseCsv('playlist__name,playlist__source_uri,streams\n"",,761\n"","",405\n');
  expect(csv.rows).toEqual([
    { playlist__name: "", playlist__source_uri: null, streams: "761" },
    { playlist__name: "", playlist__source_uri: "", streams: "405" },
  ]);
  const keys = csv.rows.map(({ streams, ...dimensions }) => JSON.stringify(dimensions));
  expect(new Set(keys).size).toBe(2);
});
