import { describe, expect, it } from "vitest";
import {
  deriveCampaignDocument,
  legacyTextToCampaignDocument,
  parseCampaignDocument,
} from "./campaign-rich-text";

describe("campaign rich text", () => {
  it("converts blank lines into paragraphs and interior newlines into hard breaks", () => {
    expect(legacyTextToCampaignDocument("First line\nsecond line\n\nThird")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "First line" },
            { type: "hardBreak" },
            { type: "text", text: "second line" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "Third" }] },
      ],
    });
  });

  it("converts blank legacy text into the required empty paragraph", () => {
    expect(parseCampaignDocument("", 20_000)).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    });
  });

  it("derives stable plain text, safe html and hash", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Fountain", marks: [{ type: "italic" }] }],
        },
      ],
    };
    const first = deriveCampaignDocument(input, 20_000);
    const second = deriveCampaignDocument(structuredClone(input), 20_000);

    expect(first).toMatchObject({ plainText: "Fountain", html: "<h2><em>Fountain</em></h2>" });
    expect(second.hash).toBe(first.hash);
  });

  it("derives the stable SHA-256 hash without a Node-only runtime dependency", () => {
    expect(deriveCampaignDocument({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Fountain" }] }],
    }, 20_000).hash).toBe("c4044ee571ffa91b0b71b155f50305d08a47fd6c910dfdf67aa22d8fb1cf3b36");
  });

  it("keeps supported formatting and normalizes safe links", () => {
    const result = deriveCampaignDocument(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Read",
                marks: [
                  { type: "bold" },
                  { type: "link", attrs: { href: "HTTPS://example.com/a?b=1" } },
                ],
              },
              { type: "hardBreak" },
              {
                type: "text",
                text: "email",
                marks: [{ type: "link", attrs: { href: "mailto:hello@example.com" } }],
              },
            ],
          },
        ],
      },
      20_000,
    );

    expect(result.html).toBe(
      '<p><a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer"><strong>Read</strong></a><br><a href="mailto:hello@example.com">email</a></p>',
    );
  });

  it.each(["strike", "code"])('rejects the forbidden %s mark', (type) => {
    expect(() =>
      deriveCampaignDocument(
        {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type }] }] },
          ],
        },
        20_000,
      ),
    ).toThrow(/mark/i);
  });

  it("serializes only approved HTML tags", () => {
    const html = deriveCampaignDocument(
      {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "heading" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "formatted", marks: [{ type: "bold" }, { type: "italic" }] },
              { type: "hardBreak" },
              { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
            ],
          },
          { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "quote" }] }] },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "item" }] },
                  {
                    type: "orderedList",
                    content: [
                      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "nested" }] }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      20_000,
    ).html;

    expect(new Set([...html.matchAll(/<\/?([a-z0-9]+)/g)].map((match) => match[1]))).toEqual(
      new Set(["a", "blockquote", "br", "em", "h2", "li", "ol", "p", "strong", "ul"]),
    );
  });

  it.each([
    [
      "hard breaks",
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(9_999) }, { type: "hardBreak" }] }] },
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(10_000) }, { type: "hardBreak" }] }] },
    ],
    [
      "paragraphs",
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(9_997) }] }, { type: "paragraph", content: [{ type: "text", text: "x" }] }] },
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(9_998) }] }, { type: "paragraph", content: [{ type: "text", text: "x" }] }] },
    ],
    [
      "lists",
      { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(9_998) }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }] }] },
      { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(9_999) }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] }] }] },
    ],
  ])("enforces derived plain text limits for %s", (_name, atLimit, oneOver) => {
    expect(() => deriveCampaignDocument(atLimit, 10_000)).not.toThrow();
    expect(() => deriveCampaignDocument(oneOver, 10_000)).toThrow(/length/i);
  });

  it.each([
    ["documents", { type: "doc", content: [] }],
    ["block quotes", { type: "doc", content: [{ type: "blockquote", content: [] }] }],
    ["lists", { type: "doc", content: [{ type: "bulletList", content: [] }] }],
    ["list items", { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [] }] }] }],
    [
      "list items that start with a nested list",
      {
        type: "doc",
        content: [
          {
            type: "bulletList",
            content: [{ type: "listItem", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [] }] }] }] }],
          },
        ],
      },
    ],
  ])("rejects empty or incorrectly sequenced %s", (_name, input) => {
    expect(() => parseCampaignDocument(input, 20_000)).toThrow(/(content|parent)/i);
  });

  it("accepts a list item with a leading paragraph followed by a nested list", () => {
    expect(() =>
      parseCampaignDocument(
        {
          type: "doc",
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "parent" }] },
                    {
                      type: "bulletList",
                      content: [
                        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "child" }] }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        20_000,
      ),
    ).not.toThrow();
  });

  it.each([
    [{ type: "doc", content: [{ type: "image", attrs: { src: "x" } }] }, "node"],
    [
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "x",
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
              },
            ],
          },
        ],
      },
      "protocol",
    ],
  ])("rejects unsafe input %#", (input, category) => {
    expect(() => parseCampaignDocument(input, 20_000)).toThrow(new RegExp(category, "i"));
  });

  it.each([
    [
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "x", marks: [{ type: "bold", attrs: { style: "color:red" } }] },
            ],
          },
        ],
      },
      "key",
    ],
    [
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x", attrs: { onclick: "alert(1)" } }],
          },
        ],
      },
      "key",
    ],
    [{ type: "doc", content: [{ type: "heading", attrs: { level: 1 } }] }, "heading"],
    [{ type: "doc", content: [{ type: "heading", attrs: { level: 4 } }] }, "heading"],
    [{ type: "doc", content: [{ type: "paragraph", marks: [{ type: "bold" }] }] }, "marks"],
    [{ type: "doc", content: [{ type: "listItem", content: [] }] }, "parent"],
    [{ type: "doc", content: [{ type: "doc", content: [] }] }, "parent"],
    [{ type: "doc", content: [], extra: true }, "key"],
  ])("rejects invalid schema input %#", (input, category) => {
    expect(() => parseCampaignDocument(input, 20_000)).toThrow(new RegExp(category, "i"));
  });

  it("enforces the maximum document depth and node count", () => {
    let deeplyNested: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "x" }],
    };
    for (let index = 0; index < 8; index += 1) {
      deeplyNested = { type: "blockquote", content: [deeplyNested] };
    }

    expect(() => parseCampaignDocument({ type: "doc", content: [deeplyNested] }, 20_000)).toThrow(/depth/i);
    expect(() =>
      parseCampaignDocument(
        {
          type: "doc",
          content: Array.from({ length: 2_001 }, () => ({ type: "paragraph", content: [] })),
        },
        20_000,
      ),
    ).toThrow(/node/i);
  });

  it.each([
    ["x".repeat(10_001), 10_000],
    ["x".repeat(20_001), 20_000],
  ])("enforces the plain text limit %#", (text, limit) => {
    expect(() => parseCampaignDocument(legacyTextToCampaignDocument(text), limit as 10_000 | 20_000)).toThrow(/length/i);
  });

  it.each([
    ["script", { type: "script", content: [] }],
    ["style", { type: "style", content: [] }],
    ["iframe", { type: "iframe", content: [] }],
    ["image", { type: "image", attrs: { src: "https://example.com/x.png" } }],
    ["data", { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "data:text/html,x" } }] }] }],
    ["javascript", { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }],
    ["encoded", { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "java%73cript:alert(1)" } }] }] }],
  ])("does not allow %# payloads into html", (_name, node) => {
    expect(() => deriveCampaignDocument({ type: "doc", content: [node] }, 20_000)).toThrow();
  });
});
