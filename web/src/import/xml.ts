// A small XML reader for the 3D exchange files (Collada), the reading side and no DOM, so it runs
// under Node too. parseXml gives the root element as a tree of names, attributes, child elements
// and text. Elements, attributes, text and CDATA are kept; comments, processing instructions and
// the doctype are skipped. The five named entities and numeric character references are decoded.
// Namespace prefixes stay in names ("xs:float"). It walks with an explicit stack and builds each
// element's text from slices joined once, so a 50 MB file (a Collada float_array) reads in linear time.

/** One element: its name, attributes, child elements and the text directly inside it. */
export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** the element's own text (not its children's), entities decoded, CDATA included */
  text: string;
}

const NAMED: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The text with its entities and character references decoded; unknown entities are left as they are. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // a code point past Unicode's range or a surrogate is left as it is rather than thrown
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

/** The attributes of one start tag's inside (`name="v" other='w'`), values decoded. */
function readAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  const re = /([^\s=\/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (let m = re.exec(s); m; m = re.exec(s)) out[m[1]] = decodeEntities(m[3] ?? m[4] ?? "");
  return out;
}

/** Throws the one error a document that does not read as XML gets. */
function bad(): never {
  throw new Error("it isn't an XML file");
}

/**
 * The root element of an XML document. Throws "it isn't an XML file" when there is no element, or
 * when the tags do not nest (an end tag that closes nothing open, or an element never closed).
 */
export function parseXml(text: string): XmlNode {
  // the root and every element still open, innermost last
  const stack: XmlNode[] = [];
  // each open element's text pieces, joined once when it closes
  const pieces: string[][] = [];
  let root: XmlNode | null = null;
  let at = 0;
  const n = text.length;
  const addText = (s: string): void => {
    if (stack.length && s) pieces[pieces.length - 1].push(s);
  };
  while (at < n) {
    const lt = text.indexOf("<", at);
    if (lt < 0) {
      addText(decodeEntities(text.slice(at)));
      break;
    }
    if (lt > at) addText(decodeEntities(text.slice(at, lt)));
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end < 0) bad();
      at = end + 3;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end < 0) bad();
      addText(text.slice(lt + 9, end));
      at = end + 3;
    } else if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      if (end < 0) bad();
      at = end + 2;
    } else if (text.startsWith("<!", lt)) {
      // the doctype, with any internal subset in brackets
      let depth = 0;
      let i = lt + 2;
      for (; i < n; i++) {
        const c = text[i];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      if (i >= n) bad();
      at = i + 1;
    } else if (text[lt + 1] === "/") {
      const end = text.indexOf(">", lt);
      if (end < 0) bad();
      const name = text.slice(lt + 2, end).trim();
      const node = stack.pop();
      if (!node || node.name !== name) bad();
      node.text = pieces.pop()!.join("");
      at = end + 1;
    } else {
      // a start tag, self-closing or not; attribute values may hold ">" so the end is found quote-aware
      let i = lt + 1;
      let quote = "";
      for (; i < n; i++) {
        const c = text[i];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      if (i >= n) bad();
      const inside = text.slice(lt + 1, i);
      const selfClosing = inside.endsWith("/");
      const body = selfClosing ? inside.slice(0, -1) : inside;
      const nameEnd = body.search(/\s/);
      const name = nameEnd < 0 ? body : body.slice(0, nameEnd);
      if (!name) bad();
      const node: XmlNode = { name, attrs: nameEnd < 0 ? Object.create(null) : readAttrs(body.slice(nameEnd)), children: [], text: "" };
      if (stack.length) stack[stack.length - 1].children.push(node);
      else if (root) bad();
      else root = node;
      if (selfClosing) {
        // closed at once: nothing is open for its text
      } else {
        stack.push(node);
        pieces.push([]);
      }
      at = i + 1;
    }
  }
  if (!root || stack.length) bad();
  return root;
}

/** The first child element of `node` with this name, or undefined (also when `node` is undefined). */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined;
  for (const c of node.children) if (c.name === name) return c;
  return undefined;
}

/** Every child element of `node` with this name, in document order (none when `node` is undefined). */
export function childrenNamed(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** The first element at or under `node` (depth first, `node` included) with this name, or undefined. */
export function find(node: XmlNode, name: string): XmlNode | undefined {
  const todo: XmlNode[] = [node];
  for (let next = todo.pop(); next; next = todo.pop()) {
    if (next.name === name) return next;
    for (let i = next.children.length - 1; i >= 0; i--) todo.push(next.children[i]);
  }
  return undefined;
}

/** Every element at or under `node` (depth first, `node` included) with this name, in document order. */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const todo: XmlNode[] = [node];
  for (let next = todo.pop(); next; next = todo.pop()) {
    if (next.name === name) out.push(next);
    for (let i = next.children.length - 1; i >= 0; i--) todo.push(next.children[i]);
  }
  return out;
}

/** An element's attribute, or undefined when it has none. */
export function attr(node: XmlNode | undefined, name: string): string | undefined {
  return node?.attrs[name];
}
