import type { Company } from "./companies";

export type UploadDraft = {
  form: Record<string, string>;
  lines: Record<string, string>[];
  active: boolean;
  pasteText: string;
  status: string;
  savedAt: string;
};

function draftKey(company: Company) {
  return `po_tracker_upload_draft_${company}`;
}

export function draftHasContent(d: Pick<UploadDraft, "form" | "lines" | "pasteText">): boolean {
  return !!(d.form.poNo?.trim() || d.lines.length > 0 || d.pasteText.trim());
}

export function loadUploadDraft(company: Company): UploadDraft | null {
  try {
    const raw = sessionStorage.getItem(draftKey(company));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UploadDraft;
    if (!parsed?.form || !Array.isArray(parsed.lines)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveUploadDraft(company: Company, draft: UploadDraft) {
  try {
    sessionStorage.setItem(draftKey(company), JSON.stringify(draft));
  } catch {
    // Ignore quota / private mode errors — draft just won't persist.
  }
}

export function clearUploadDraft(company: Company) {
  try {
    sessionStorage.removeItem(draftKey(company));
  } catch {
    // ignore
  }
}
