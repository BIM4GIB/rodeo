// The converter: any file Rodeo reads made into a drawing without the editor (readAny), written in
// any format Rodeo writes (writeAs), described (describe). No DOM: the command line runs it in Node
// (import ./node.ts first), the converter page in a worker, the MCP server's headless mode in Node.

export type { DrawingSummary, FormatInfo, HeadlessDrawing, LayerSummary, ReadOptions, Unit, WriteOptions, WrittenFile } from "./types.ts";
export { formatById, formatInfo, formatOfName, formats, outputFormat } from "./formats.ts";
export { libraries, useLibraries, type Libraries } from "./libs.ts";
export { readAny } from "./read.ts";
export { writeAs } from "./write.ts";
export { describe, summaryLine, summaryText } from "./describe.ts";
