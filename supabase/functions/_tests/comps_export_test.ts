import { assertEquals } from "@std/assert";
import { compsCsv, CSV_HEAD, parseRequest } from "../_shared/comps_export/service.ts";

Deno.test("export-comps accepts 1-500 slugs and nothing else", () => {
  assertEquals(parseRequest({ item_ids: ["a-bear"] }), { itemIds: ["a-bear"] });
  assertEquals("error" in parseRequest({ item_ids: [] }), true);
  assertEquals("error" in parseRequest({ item_ids: ["../etc"] }), true);
});

Deno.test("an empty export is just the header row", () => {
  assertEquals(compsCsv([]), CSV_HEAD.join(",") + "\r\n");
});
