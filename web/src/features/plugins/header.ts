// A plug-in's header: the // @name, // @description, // @version and // @author
// comment lines at the top of its code. Pure, so it runs under Node too.

export interface PluginHeader {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly author: string;
}

/** Name shown when a plug-in's code has no // @name line. */
export const UNTITLED = "Untitled Plug-in";

const FIELD = /^\s*\/\/\s*@(name|description|version|author)\b\s*(.*?)\s*$/i;

/** The header fields found in the first lines of `code` (the first of each wins). */
export function parseHeader(code: string): PluginHeader {
  const out: Record<"name" | "description" | "version" | "author", string> = { name: "", description: "", version: "", author: "" };
  const lines = code.split(/\r?\n/, 60);
  for (const line of lines) {
    if (line.trim() === "" || /^\s*\/\/(?!\s*@)/.test(line)) continue;
    const m = FIELD.exec(line);
    if (m) {
      const key = m[1].toLowerCase() as keyof typeof out;
      if (out[key] === "") out[key] = m[2];
      continue;
    }
    // the header ends at the first line of code
    if (!/^\s*\/\//.test(line)) break;
  }
  return { ...out, name: out.name || UNTITLED };
}

/** The header lines a new plug-in starts with. */
export function headerTemplate(name: string): string {
  return ["// @name " + name, "// @description What this plug-in does.", "// @version 1.0", "// @author ", ""].join("\n");
}
