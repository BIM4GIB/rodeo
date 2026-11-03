// File names for drawings kept in a drive.

/** Whether a file name is a Vectorworks drawing (.vwx). */
export function isDrawing(name: string): boolean {
  return /\.vwx$/i.test(name);
}

/** The file name for what the user typed (".vwx" added when missing), or why it cannot be used. */
export function drawingName(typed: string): { readonly name: string } | { readonly error: string } {
  const base = typed.trim();
  if (base === "") return { error: "Enter a file name." };
  if (/[\\/:*?"<>|]/.test(base)) return { error: 'A file name cannot contain \\ / : * ? " < > |' };
  return { name: isDrawing(base) ? base : `${base}.vwx` };
}
