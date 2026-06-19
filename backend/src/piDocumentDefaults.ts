import type { Company } from "./companies.js";

export interface PiDocumentSettings {
  issuerName?: string;
  issuerAddress?: string;
  customerName?: string;
  customerTrn?: string;
  salesPerson?: string;
  currency?: string;
  paymentTerms?: string;
  incoterms?: string;
  partialDelivery?: string;
  shipmentMode?: string;
  productCategory?: string;
  bankName?: string;
  accountTitle?: string;
  accountNo?: string;
  swift?: string;
  iban?: string;
  bankAddress?: string;
  terms?: string[];
  taxNote?: string;
}

export const DEFAULT_PI_DOCUMENT: PiDocumentSettings = {
  issuerName: "NextGen Building Supplies Trading FZE LLC",
  issuerAddress: "BC-630930 2nd Floor, Amber Gem Tower, Ajman, UAE",
  customerName: "TIMBERBASE, A UFP Industries Company",
  customerTrn: "",
  salesPerson: "Sarfaraz Khan",
  currency: "USD",
  paymentTerms: "50% Advance, Balance Upon BL Copy",
  incoterms: "Ex-Works",
  partialDelivery: "No",
  shipmentMode: "By Sea",
  productCategory: "Alunova Composite Panel",
  bankName: "ABU DHABI ISLAMIC BANK",
  accountTitle: "NEXTGEN BUILDING SUPPLIES TRADING FZE LLC",
  accountNo: "29336872 - USD",
  swift: "ABDIAEADXXX - USD",
  iban: "AE31050000000029336872",
  bankAddress: "SHEIKH RASHID BIN SAEED STREET, ABU DHABI, U.A.E.",
  terms: [
    "Tolerance in Material: +/- 10% of the ordered quantity is acceptable.",
    "Tolerance in Quantity: +/- 10% of the ordered quantity is acceptable.",
    "Tolerance in Color: +/- 10% of the ordered quantity is acceptable.",
  ],
  taxNote:
    "As per the Federal Decree Law No. 8 of 2017 on Value Added Tax, the supply of goods and services under Reverse Charge Basis is subject to VAT at 5%. The recipient is responsible for accounting for VAT under the Reverse Charge mechanism.",
};

const SYNERGY_CUSTOMER = "Synergy Building Products";

export function parsePiDocument(master: unknown): PiDocumentSettings {
  if (!master || typeof master !== "object") return {};
  const doc = (master as Record<string, unknown>).piDocument;
  if (!doc || typeof doc !== "object") return {};
  return doc as PiDocumentSettings;
}

export function resolvePiDocument(company: Company, master?: unknown): Required<PiDocumentSettings> {
  const cfg = parsePiDocument(master);
  const base: Required<PiDocumentSettings> = {
    ...DEFAULT_PI_DOCUMENT,
    ...cfg,
    terms: cfg.terms?.length ? cfg.terms : DEFAULT_PI_DOCUMENT.terms!,
  };
  if (!cfg.customerName && company === "SYNERGY") {
    base.customerName = SYNERGY_CUSTOMER;
  }
  return base;
}
