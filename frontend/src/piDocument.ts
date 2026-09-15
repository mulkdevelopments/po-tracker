export interface PiDocumentSettings {
  issuerName?: string;
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
    "Tolerance in Material: Aluminium Skin: +/- 0.05mm, +/- 2.0mm, Length: +/- 4.0mm, Thickness: +/- 0.2mm for 4MM",
    "Tolerance in Quantity: Total Quantity Would Be (+)0-2% Subject to Production Run",
    "Tolerance in Color Between Batches: Color Variation b/w Batches: dE <= 2.0",
    "Tolerance in Surface Defects: if not visible from 3ft. distance, quality is acceptable.",
  ],
  taxNote:
    "Nextgen Building Supplies Trading FZE LLC As per article 48 of Decree Law No. 8, \u201cCustomer shall be responsible for tax obligations and accounting of tax in respect of these supplies on Reverse Charge Basis",
};

export function piDocumentFromMaster(master: unknown): PiDocumentSettings {
  if (!master || typeof master !== "object") return { ...DEFAULT_PI_DOCUMENT };
  const doc = (master as Record<string, unknown>).piDocument;
  if (!doc || typeof doc !== "object") return { ...DEFAULT_PI_DOCUMENT };
  return { ...DEFAULT_PI_DOCUMENT, ...(doc as PiDocumentSettings) };
}
