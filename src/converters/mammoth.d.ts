/**
 * mammoth 无官方类型 (npm 上也不存在 @types/mammoth), 这里只声明本项目用到的 API
 * https://nightblue.github.io/mammoth.js/
 */
declare module 'mammoth' {
  export interface MammothMessage {
    type: string;
    message: string;
  }

  export interface ConvertInput {
    path?: string;
    arrayBuffer?: ArrayBuffer;
  }

  export interface ConvertOutput {
    /** 转换结果 (markdown 或 html) */
    value: string;
    /** 样式映射等警告, 不影响正文 */
    messages: MammothMessage[];
  }

  const mammoth: {
    convertToMarkdown(input: ConvertInput): Promise<ConvertOutput>;
    convertToHtml(input: ConvertInput): Promise<ConvertOutput>;
    extractRawText(input: ConvertInput): Promise<ConvertOutput>;
  };

  export default mammoth;
}
