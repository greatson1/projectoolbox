declare module "html-to-docx" {
  interface HTMLtoDOCXOptions {
    title?: string;
    subject?: string;
    creator?: string;
    margin?: { top?: number; right?: number; bottom?: number; left?: number };
    font?: string;
    fontSize?: number;
    complexScriptsFont?: string;
    [key: string]: unknown;
  }
  function HTMLtoDOCX(
    html: string,
    headerHtml: string | undefined,
    options?: HTMLtoDOCXOptions,
    footerHtml?: string,
  ): Promise<Buffer>;
  export default HTMLtoDOCX;
}
