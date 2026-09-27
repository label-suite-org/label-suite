export type GrantReportPackDocument = {
  id: string;
  name: string;
  linkType: string;
  downloadUrl: string | null;
};

export type GrantReportPackLineInput = {
  id: string;
  name: string;
  category: string | null;
  planned: number;
  committed: number;
  paid: number;
  documents: GrantReportPackDocument[];
};

export type GrantReportPack = {
  applicationId: string;
  awardAmount: number;
  spendToDate: number;
  remainingAward: number;
  lines: Array<GrantReportPackLineInput & { actual: number; variance: number }>;
  documents: GrantReportPackDocument[];
  receiptCompleteness: { paidLines: number; paidLinesWithReceipts: number; paidLinesWithoutReceipts: number };
  warnings: Array<{ code: "missing_receipt" | "outside_restricted_use"; lineId: string; message: string }>;
};

export function buildGrantReportPack(input: {
  applicationId: string;
  awardAmount: number;
  restrictedTo?: string | null;
  lines: GrantReportPackLineInput[];
}): GrantReportPack {
  const lines = [...new Map(input.lines.map((line) => [line.id, line])).values()]
    .map((line) => ({ ...line, actual: line.paid, variance: line.planned - line.paid }));
  const documents = lines.flatMap((line) => line.documents);
  const paidLines = lines.filter((line) => line.paid > 0);
  const paidLinesWithReceipts = paidLines.filter((line) => line.documents.some((document) => document.linkType === "receipt" || document.linkType === "invoice")).length;
  const restricted = String(input.restrictedTo ?? "").split(/[,;]+/).map((value) => value.trim().toLowerCase()).filter(Boolean);
  const warnings: GrantReportPack["warnings"] = [];
  for (const line of lines) {
    if (line.paid > 0 && !line.documents.some((document) => document.linkType === "receipt" || document.linkType === "invoice")) {
      warnings.push({ code: "missing_receipt", lineId: line.id, message: `${line.name} has paid spend without a receipt or invoice.` });
    }
    if (restricted.length && line.category && !restricted.includes(line.category.toLowerCase())) {
      warnings.push({ code: "outside_restricted_use", lineId: line.id, message: `${line.name} is outside the funding source restriction (${input.restrictedTo}).` });
    }
  }
  const spendToDate = lines.reduce((sum, line) => sum + line.paid, 0);
  return {
    applicationId: input.applicationId,
    awardAmount: input.awardAmount,
    spendToDate,
    remainingAward: Math.max(0, input.awardAmount - spendToDate),
    lines,
    documents,
    receiptCompleteness: { paidLines: paidLines.length, paidLinesWithReceipts, paidLinesWithoutReceipts: paidLines.length - paidLinesWithReceipts },
    warnings,
  };
}
