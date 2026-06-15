declare module "pdf-parse" {
  interface PdfData {
    numpages: number;
    text: string;
  }
  function pdf(buffer: Buffer): Promise<PdfData>;
  export default pdf;
}
