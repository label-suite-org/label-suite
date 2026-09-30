import { describe, expect, it } from "vitest";
import {
  M0_DISPOSITIONS,
  compareRecordEvidence,
  scopedParityTable,
  buildKeyRecordEvidence,
  assertM0AuditTargetHealth,
  buildM0Audit,
  renderM0Markdown,
  type ParityReport,
} from "./m0-parity-audit-core";

function parity(overrides: Partial<ParityReport> = {}): ParityReport {
  return {
    generatedAt: "2026-08-16T04:15:11.616Z",
    orgId: "fixture-org",
    baseId: "app-test",
    schema: "label_suite",
    metadataAvailable: true,
    tableResults: [
      { spec: { airtable: "Artists", postgres: "artists", status: "mapped" }, airtableCount: 2, postgresCount: 1 },
      { spec: { airtable: "Contacts", postgres: "contacts", status: "mapped" }, airtableCount: 2, postgresCount: 2 },
      { spec: { airtable: "Release Tracks", postgres: "tracks", status: "mapped" }, airtableCount: 1, postgresCount: 1 },
    ],
    keyChecks: [],
    sourceIdChecks: [],
    integrityChecks: [],
    readinessChecks: [],
    ...overrides,
  };
}

describe("M0 parity audit", () => {
  it("binds production evidence to an exact healthy deployed revision", () => {
    expect(assertM0AuditTargetHealth({
      revision: "1234567890abcdef1234567890abcdef12345678",
      web: "ok",
      database: "ok",
      worker: "ok",
      application: { status: "ok" },
      analytics: { status: "degraded" },
    }, "1234567890abcdef1234567890abcdef12345678")).toBe("1234567890abcdef1234567890abcdef12345678");
    expect(() => assertM0AuditTargetHealth({
      revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      web: "ok",
      database: "ok",
      worker: "ok",
      application: { status: "ok" },
    }, "1234567890abcdef1234567890abcdef12345678")).toThrow("revision mismatch");
  });

  it("builds secret-free record evidence from stable source and canonical identities", () => {
    expect(buildKeyRecordEvidence(
      [
        { recordId: "rec-b", normalizedValue: "artist b", value: "Artist B" },
        { recordId: "rec-a", normalizedValue: "artist a", value: "Artist A" },
      ],
      [{ recordId: "artist-c", normalizedValue: "artist c", value: "Artist C" }],
    )).toEqual({
      missingInPostgres: ["Artist A", "Artist B"],
      extraInPostgres: ["Artist C"],
      missingInPostgresRecords: [
        { identity: "rec-a", recordIds: ["rec-a"], value: "Artist A" },
        { identity: "rec-b", recordIds: ["rec-b"], value: "Artist B" },
      ],
      extraInPostgresRecords: [
        { identity: "artist-c", recordIds: ["artist-c"], value: "Artist C" },
      ],
    });
  });

  it("retains record identities and groups only complete equivalent mismatch sets", () => {
    const report = buildM0Audit(parity({
      tableResults: [
        {
          spec: { airtable: "Artists", postgres: "artists", status: "mapped" },
          airtableCount: 3,
          postgresCount: 1,
          sourceRecordIds: ["rec-a", "rec-b", "rec-exception"],
          canonicalRecordIds: ["artist-a"],
        },
      ],
      keyChecks: [{
        table: "Artists",
        label: "name",
        airtableField: "Name",
        airtableKeyCount: 3,
        postgresKeyCount: 1,
        missingInPostgres: ["Artist B", "Artist A"],
        extraInPostgres: [],
        missingInPostgresRecords: [
          { identity: "artist-b", recordIds: ["rec-b"], value: "Artist B" },
          { identity: "artist-a", recordIds: ["rec-a"], value: "Artist A" },
        ],
        extraInPostgresRecords: [],
      }],
    }));

    expect(report.reportVersion).toBe("m0-parity-audit.v2");
    expect(report.mismatches.find((row) => row.id.endsWith(":artist-a"))).toMatchObject({
      sourceRecordIds: ["rec-a"],
      canonicalRecordIds: [],
    });
    expect(report.proposedGroups).toEqual([
      expect.objectContaining({
        sharedRule: "artist-relationships/key_missing/Artists/artists/name",
        memberMismatchIds: [
          "key:artists:name:missing:artist-a",
          "key:artists:name:missing:artist-b",
        ],
        exceptionMismatchIds: [],
        proposedDisposition: "Human review required",
      }),
    ]);
    expect(report.individualReviewMismatchIds).toEqual(["count:artists"]);
  });

  it("keeps explicit group exceptions and unmatched mismatches individually review-required", () => {
    const input = parity({
      keyChecks: [{
        table: "Artists",
        label: "name",
        airtableField: "Name",
        airtableKeyCount: 3,
        postgresKeyCount: 0,
        missingInPostgres: ["Artist A", "Artist B", "Artist C"],
        extraInPostgres: [],
      }],
      groupExceptions: {
        "artist-relationships/key_missing/Artists/artists/name": [
          "key:artists:name:missing:artist-c",
        ],
      },
    });

    const report = buildM0Audit(input);
    expect(report.proposedGroups[0].memberMismatchIds).toEqual([
      "key:artists:name:missing:artist-a",
      "key:artists:name:missing:artist-b",
    ]);
    expect(report.proposedGroups[0].exceptionMismatchIds).toEqual([
      "key:artists:name:missing:artist-c",
    ]);
    expect(report.individualReviewMismatchIds).toContain("key:artists:name:missing:artist-c");
    expect(report.mismatches.find((row) => row.id.endsWith(":artist-c"))?.proposedDisposition)
      .toBe("Human review required");
  });

  it("renders immutable group membership, explicit exceptions, and record identities", () => {
    const report = buildM0Audit(parity({
      keyChecks: [{
        table: "Artists",
        label: "name",
        airtableField: "Name",
        airtableKeyCount: 2,
        postgresKeyCount: 0,
        missingInPostgres: ["Artist A", "Artist B"],
        extraInPostgres: [],
        missingInPostgresRecords: [
          { identity: "artist-a", recordIds: ["rec-a"], value: "Artist A" },
          { identity: "artist-b", recordIds: ["rec-b"], value: "Artist B" },
        ],
      }],
    }));

    const markdown = renderM0Markdown(report);
    expect(markdown).toContain("## Proposed grouped dispositions");
    expect(markdown).toContain("Complete immutable member list");
    expect(markdown).toContain("key:artists:name:missing:artist-a");
    expect(markdown).toContain("rec-a");
    expect(markdown).toContain("Exceptions: none");
    expect(markdown).toContain("## Individual review required");
  });

  it("creates deterministic count, key, source-id, and deep-check mismatch records", () => {
    const report = buildM0Audit(parity({
      keyChecks: [{
        table: "Contacts",
        label: "email",
        airtableField: "Email",
        airtableKeyCount: 1,
        postgresKeyCount: 2,
        missingInPostgres: ["person@example.com"],
        extraInPostgres: ["extra@example.com"],
      }],
      sourceIdChecks: [{ airtable: "Artists", postgres: "artists", preservedIds: 1, importedRecords: 2, airtableRecords: 2 }],
      integrityChecks: [{ label: "Tracks missing work", count: 2, samples: ["track-2", "track-1"] }],
      readinessChecks: [{ label: "Tracks marked ready while missing ISRC", count: 1, samples: ["track-3"] }],
    }));

    expect(report.mismatches.map((mismatch) => mismatch.id)).toEqual([
      "count:artists",
      "integrity:tracks-missing-work:track-1",
      "integrity:tracks-missing-work:track-2",
      "key:contacts:email:extra:email-c24b1b1f0518",
      "key:contacts:email:missing:email-542d24012988",
      "readiness:tracks-marked-ready-while-missing-isrc:track-3",
      "source-id:artists",
    ]);
    expect(report.mismatches.every((mismatch) => mismatch.proposedDisposition === "Human review required")).toBe(true);
    expect(report.safety.noMutation).toBe(true);
    expect(report.source.targetRevision).toBe("not-supplied");
    expect(report.sections.find((section) => section.issue === 84)?.mismatchIds).toContain("count:artists");
    expect(report.sections.find((section) => section.issue === 86)?.mismatchIds).toContain("key:contacts:email:extra:email-c24b1b1f0518");
    expect(JSON.stringify(report)).not.toContain("person@example.com");
  });

  it("does not treat source-only records as failed source-ID preservation", () => {
    const report = buildM0Audit(parity({
      sourceIdChecks: [{
        airtable: "ISRC Sequences",
        postgres: "isrc_sequences",
        preservedIds: 0,
        importedRecords: 0,
        airtableRecords: 3,
      }],
    }));

    expect(report.mismatches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "source-id:isrc-sequences" }),
    ]));
  });

  it("refuses to build a packet from sampled deep-check evidence", () => {
    expect(() => buildM0Audit(parity({
      integrityChecks: [{ label: "Tracks missing work", count: 3, samples: ["track-1", "track-2"] }],
    }))).toThrow("complete record identities");
  });

  it("records the sanitized commands used to produce the packet", () => {
    const commands = [
      "npm run m0:parity -- --output <new-path> --target-revision 1234567890abcdef1234567890abcdef12345678 --health-url <https-health-url>",
    ];
    expect(buildM0Audit(parity({ auditCommands: commands })).safety.commands).toEqual(commands);
  });

  it("keeps the disposition vocabulary exact and renders separate M0 sections", () => {
    const report = buildM0Audit(parity());
    expect(report.safety.dispositionVocabulary).toEqual(M0_DISPOSITIONS);
    expect(report.sections.map((section) => section.issue)).toEqual([25, 84, 85, 86]);
    const markdown = renderM0Markdown(report);
    expect(markdown).toContain("# Immutable M0 Parity Audit");
    expect(markdown).toContain("No Airtable or Postgres mutation");
    expect(markdown).toContain("| #84 | Artist relationship cleanup/control consistency |");
  });

  it("orders equivalent input deterministically", () => {
    const input = parity({
      keyChecks: [{
        table: "Artists",
        label: "name",
        airtableField: "Name",
        airtableKeyCount: 0,
        postgresKeyCount: 2,
        missingInPostgres: ["Zed", "Amy"],
        extraInPostgres: [],
      }],
    });
    const first = buildM0Audit(input);
    const second = buildM0Audit({ ...input, keyChecks: [{ ...input.keyChecks[0], missingInPostgres: ["Amy", "Zed"] }] });
    expect(first).toEqual(second);
  });

  it("binds the packet to an exact source evidence revision", () => {
    const report = buildM0Audit(parity({ sourceRevision: "airtable-evidence-sha256:abc123" }));
    expect(report.source.sourceRevision).toBe("airtable-evidence-sha256:abc123");
  });

  it("redacts email, URL, and token-like mismatch values", () => {
    const report = buildM0Audit(parity({
      keyChecks: [{
        table: "Artists",
        label: "name",
        airtableField: "Name",
        airtableKeyCount: 3,
        postgresKeyCount: 0,
        missingInPostgres: [
          "person@example.com",
          "https://private.example/path?token=secret",
          "pat_secret_value_1234567890",
        ],
        extraInPostgres: [],
      }],
    }));
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("private.example");
    expect(serialized).not.toContain("pat_secret_value_1234567890");
    expect(serialized).toMatch(/\[redacted:[a-f0-9]{12}\]/);
  });
});


describe("record-level parity evidence", () => {
  it("scopes every canonical table and rejects partial source coverage", () => {
    expect(() => buildM0Audit(parity({ orgId: undefined }))).toThrow("explicit organization scope");
    expect(scopedParityTable("label_suite", "contacts", "owner's-org")).toBe('(select * from "label_suite"."contacts" where org_id = \'owner\'\'s-org\')');
    const report = parity();
    report.tableResults[0].truncated = true;
    expect(() => buildM0Audit(report)).toThrow("complete source evidence");
    report.tableResults[0].truncated = false;
    report.tableResults[0].error = "source unavailable";
    expect(() => buildM0Audit(report)).toThrow("complete source evidence");
  });
  it("retains canonical-only evidence and compares split directory counts", () => {
    const canonical = compareRecordEvidence({ table: "Contacts", canonicalTable: "contacts", field: "name", sourceRecordId: null, sourceValue: null, canonicalRecordIds: ["native-contact"], canonicalValues: ["Native contact"] });
    const report = buildM0Audit(parity({ recordChecks: [canonical], tableResults: [{ spec: { airtable: "Contacts", postgres: "contacts", status: "mapped" }, airtableCount: 3, postgresCount: 1 }], directoryCounts: [
      { spec: { airtable: "Contacts", postgres: "contacts", status: "mapped" }, airtableCount: 1, postgresCount: 1 },
      { spec: { airtable: "Contacts", postgres: "organizations", status: "mapped" }, airtableCount: 2, postgresCount: 2 },
    ] }));
    expect(report.scope.countDeltas).toBe(0);
    expect(report.checks.tableCounts).toHaveLength(2);
    expect(report.checks.records[0].status).toBe("canonical-only");
    expect(report.mismatches[0].sourceRecordIds).toEqual([]);
    expect(report.mismatches[0].canonicalRecordIds).toEqual(["native-contact"]);
    expect(report.mismatches[0].proposedDisposition).toBe("Human review required");
    const split = buildM0Audit(parity({ keyChecks: ["contacts", "organizations"].map(canonicalTable => ({ table: "Contacts", canonicalTable, label: "name", airtableField: "Name", airtableKeyCount: 1, postgresKeyCount: 0, missingInPostgres: ["Same name"], extraInPostgres: [] })), sourceIdChecks: ["contacts", "organizations"].map(postgres => ({ airtable: "Contacts", postgres, preservedIds: 0, importedRecords: 1, airtableRecords: 1 })) }));
    expect(new Set(split.mismatches.map(row => row.id)).size).toBe(split.mismatches.length);
    expect(split.mismatches.filter(row => row.kind === "key_missing").map(row => row.canonicalTable).sort()).toEqual(["contacts", "organizations"]);
  });
  it("retains matched coverage and reports different, unmapped, ambiguous and unavailable identities without guessing", () => {
    const base = { table: "Rights Lines (Roles)", canonicalTable: "roles", field: "ownership_type", sourceRecordId: "rec-role", sourceValue: "Rights", canonicalRecordIds: ["role-1"], canonicalValues: ["Rights"] };
    expect(compareRecordEvidence(base).status).toBe("matched");
    expect(compareRecordEvidence({ ...base, sourceValue: null, canonicalValues: ["Rights"] }).status).toBe("different");
    expect(compareRecordEvidence({ ...base, sourceValue: null }, false).status).toBe("unavailable");
    expect(compareRecordEvidence({ ...base, canonicalValues: ["Credit"] }).status).toBe("different");
    expect(compareRecordEvidence({ ...base, canonicalRecordIds: [], canonicalValues: [] }).status).toBe("unmapped");
    expect(compareRecordEvidence({ ...base, canonicalRecordIds: ["role-1", "role-2"], canonicalValues: ["Rights", "Rights"] }).status).toBe("ambiguous");
    expect(compareRecordEvidence(base, false).status).toBe("unavailable");
    const matched = compareRecordEvidence(base);
    const different = compareRecordEvidence({ ...base, sourceRecordId: "rec-other", canonicalValues: ["Credit"] });
    const report = buildM0Audit(parity({ recordChecks: [different, matched] }));
    const reverse = buildM0Audit(parity({ recordChecks: [matched, different] }));
    expect(report).toEqual(reverse);
    expect(report.checks.records).toHaveLength(2);
    const mismatch = report.mismatches.find(row => row.kind === "record_value")!;
    expect(mismatch.sourceValue).toBe("Rights");
    expect(mismatch.canonicalValue).toBe('["Credit"]');
    expect(mismatch.sourceRecordIds).toEqual(["rec-other"]);
    expect(mismatch.canonicalRecordIds).toEqual(["role-1"]);
    expect(mismatch.proposedDisposition).toBe("Human review required");
    const privateReport = buildM0Audit(parity({ recordChecks: [compareRecordEvidence({ ...base, sourceValue: "owner@example.com", sourceRawValue: "owner@example.com", sourceField: "Role", canonicalValues: ["other@example.com"] })] }));
    expect(JSON.stringify(privateReport)).not.toContain("@example.com");
    expect(privateReport.checks.records[0].sourceValue).toMatch(/^\[email:/);
    expect(report.safety.noMutation).toBe(true);
  });
});
