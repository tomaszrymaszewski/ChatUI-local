declare module "html2pdf.js" {
  interface Html2PdfOptions {
    margin?: number | number[];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: Record<string, unknown>;
    jsPDF?: Record<string, unknown>;
    pagebreak?: Record<string, unknown>;
  }
  interface Html2PdfWorker {
    set(options: Html2PdfOptions): Html2PdfWorker;
    from(source: HTMLElement | string): Html2PdfWorker;
    save(): Promise<void>;
    toPdf(): Html2PdfWorker;
    output(type?: string, options?: unknown): Promise<unknown>;
  }
  function html2pdf(): Html2PdfWorker;
  export default html2pdf;
}
