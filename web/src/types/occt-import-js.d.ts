// occt-import-js's CommonJS build (OpenCascade compiled to WebAssembly, LGPL-2.1), which ships no typings:
// its Emscripten factory, as module.exports. What it resolves to is typed where import/occt.ts uses it.
declare module "occt-import-js" {
  const occtimportjs: (options?: { print?: (text: string) => void; locateFile?: (path: string) => string }) => Promise<unknown>;
  export default occtimportjs;
}
