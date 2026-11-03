// Builds the source of a plug-in's Web Worker: a small bootstrap that defines the
// global `openvwx` (async calls answered by the host), forwards console output,
// stubs the network and storage entry points, and then the plug-in's own code,
// wrapped as `self.__ovEntry = async function () { ... };`. The source is plain
// text (no bundler helpers), so it runs as it is in the worker.
//
// Line numbers: the plug-in's line n is script line `offset + n`, where `offset`
// is the number of lines before its first line. Errors cross to the host with
// their script lines; the host turns them into the plug-in's own lines.

import { DOC_METHODS, EDIT_METHODS } from "./dispatch.ts";

export interface WorkerSource {
  /** the classic script to pass to new Worker(blobUrl) */
  readonly source: string;
  /** script lines before the plug-in's first line */
  readonly offset: number;
}

/** Names a plug-in's code is not allowed to reach in its worker. */
export const STUBBED = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches"] as const;

const BOOTSTRAP = String.raw`// openvwx plug-in worker (bootstrap). Written by the host; not user code.
var __ovPending = new Map();
var __ovSeq = 0;
var __ovMenus = new Map();
var __ovMenuSeq = 0;
var __ovSelfUrl = self.location.href;
var __ovOffset = __OV_OFFSET__;

// the script line of the plug-in's own frame that threw (frames of this bootstrap are skipped)
function __ovLine(err) {
  var stack = err && err.stack ? String(err.stack) : "";
  var lines = stack.split("\n");
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(__ovSelfUrl) < 0) continue;
    var m = /:(\d+):\d+\)?\s*$/.exec(lines[i]);
    if (m && Number(m[1]) > __ovOffset) return Number(m[1]);
  }
  return null;
}

function __ovErr(err) {
  if (err && typeof err === "object" && "message" in err) {
    return { name: String(err.name || "Error"), message: String(err.message), line: __ovLine(err) };
  }
  return { name: "Error", message: String(err), line: null };
}

function __ovRebuild(e) {
  var err = new Error(String(e && e.message));
  err.name = String((e && e.name) || "Error");
  return err;
}

function __ovPost(message) {
  self.postMessage(message);
}

function __ovCall(method, args) {
  return new Promise(function (resolve, reject) {
    var id = ++__ovSeq;
    __ovPending.set(id, { resolve: resolve, reject: reject });
    try {
      __ovPost({ type: "call", id: id, method: method, args: args });
    } catch (e) {
      __ovPending.delete(id);
      reject(e);
    }
  });
}

function __ovText(v, max) {
  var s;
  if (typeof v === "string") s = v;
  else if (v === undefined) s = "undefined";
  else if (typeof v === "function") s = "[function " + (v.name || "anonymous") + "]";
  else if (typeof v === "symbol") s = v.toString();
  else if (typeof v === "bigint") s = String(v) + "n";
  else if (v instanceof Error) s = String(v.name) + ": " + String(v.message);
  else if (typeof v !== "object" || v === null) s = String(v);
  else {
    try {
      s = JSON.stringify(v, function (k, x) {
        if (typeof x === "bigint") return String(x) + "n";
        if (ArrayBuffer.isView(x)) return "[" + x.constructor.name + " " + x.length + "]";
        if (x instanceof Map) return "Map(" + x.size + ")";
        if (x instanceof Set) return "Set(" + x.size + ")";
        return x;
      });
    } catch (e) {
      s = undefined;
    }
    if (s === undefined) s = String(v);
  }
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function __ovLog(level, args) {
  var parts = [];
  var line = null;
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (line === null && a instanceof Error) line = __ovLine(a);
    parts.push(__ovText(a, 2000));
  }
  __ovPost({ type: "log", level: level, text: parts.join(" "), line: line });
}

["log", "info", "debug", "warn", "error"].forEach(function (name) {
  var level = name === "warn" ? "warn" : name === "error" ? "error" : "log";
  console[name] = function () {
    __ovLog(level, Array.prototype.slice.call(arguments));
  };
});

function __ovMake(names, prefix) {
  var out = {};
  names.forEach(function (name) {
    out[name] = function () {
      return __ovCall(prefix + name, Array.prototype.slice.call(arguments));
    };
  });
  return out;
}

function __ovInit(init) {
  var out = {};
  if (!init || typeof init !== "object") return out;
  if (init.method !== undefined) out.method = String(init.method);
  if (init.headers !== undefined && init.headers !== null) {
    out.headers = {};
    var hs = init.headers;
    if (Array.isArray(hs)) hs.forEach(function (p) { out.headers[String(p[0])] = String(p[1]); });
    else Object.keys(hs).forEach(function (k) { out.headers[k] = String(hs[k]); });
  }
  var b = init.body;
  if (b !== undefined && b !== null) {
    if (typeof b === "string") out.body = b;
    else if (b instanceof ArrayBuffer) out.body = new Uint8Array(b).slice();
    else if (ArrayBuffer.isView(b)) out.body = new Uint8Array(b.buffer, b.byteOffset, b.byteLength).slice();
    else out.body = String(b);
  }
  return out;
}

var __ovDocApi = __ovMake(__OV_DOC__, "doc.");
var __ovEditApi = __ovMake(__OV_EDIT__, "edit.");
__ovEditApi.batch = function (steps) {
  return __ovCall("edit.batch", [steps]);
};

self.openvwx = Object.freeze({
  version: 1,
  doc: Object.freeze(__ovDocApi),
  edit: Object.freeze(__ovEditApi),
  select: function (ids) {
    return __ovCall("select", [ids]);
  },
  zoomTo: function (ids) {
    return __ovCall("zoomTo", [ids]);
  },
  activeLayer: function () {
    return __ovCall("activeLayer", []);
  },
  setActiveLayer: function (id) {
    return __ovCall("setActiveLayer", [id]);
  },
  ui: Object.freeze({
    toast: function (text) {
      return __ovCall("ui.toast", [String(text)]);
    },
    alert: function (title, text) {
      return __ovCall("ui.alert", [String(title), String(text)]);
    },
    prompt: function (title, fields) {
      return __ovCall("ui.prompt", [String(title), fields]);
    },
    progress: function (fraction, label) {
      return __ovCall("ui.progress", [fraction === null || fraction === undefined ? null : Number(fraction), label === undefined ? "" : String(label)]);
    },
  }),
  menu: Object.freeze({
    add: function (label, handler) {
      if (typeof label !== "string" || label === "" || typeof handler !== "function") {
        throw new TypeError("openvwx.menu.add(label, handler) takes a label and a function");
      }
      var id = "m" + (++__ovMenuSeq);
      __ovMenus.set(id, handler);
      __ovPost({ type: "menu", id: id, label: label });
    },
  }),
  fetch: function (url, init) {
    return __ovCall("fetch", [String(url), __ovInit(init)]);
  },
});

// Before any plug-in code runs: the network and storage entry points throw.
__OV_STUBS__.forEach(function (name) {
  var stub = function () {
    throw new Error(name + " is not available to plug-ins. Use openvwx.fetch(url, init) for web requests.");
  };
  try {
    Object.defineProperty(self, name, { value: stub, writable: false, configurable: false });
  } catch (e) {
    // a property the browser will not redefine stays as it is
  }
});

function __ovStart(id) {
  var entry = self.__ovEntry;
  Promise.resolve()
    .then(function () {
      if (typeof entry !== "function") throw new Error("This script has no code to run.");
      return entry();
    })
    .then(
      function (v) {
        // what the code returned, for the Agents panel's scripts
        __ovPost({ type: "done", id: id, ok: true, text: v === undefined ? undefined : __ovText(typeof v === "string" ? JSON.stringify(v) : v, __OV_EVAL_MAX__) });
      },
      function (err) {
        __ovPost({ type: "done", id: id, ok: false, error: __ovErr(err) });
      },
    );
}

function __ovInvoke(id, menu) {
  var fn = __ovMenus.get(menu);
  Promise.resolve()
    .then(function () {
      if (!fn) throw new Error("That menu item is no longer installed.");
      return fn();
    })
    .then(
      function () {
        __ovPost({ type: "invoked", id: id, ok: true });
      },
      function (err) {
        __ovPost({ type: "invoked", id: id, ok: false, error: __ovErr(err) });
      },
    );
}

var __ovAsync = Object.getPrototypeOf(async function () {}).constructor;

// The script console: an expression is returned; anything else runs as a body.
function __ovEval(id, code) {
  var fn;
  try {
    fn = new __ovAsync("return (" + code + "\n);");
  } catch (e1) {
    try {
      fn = new __ovAsync(code);
    } catch (e2) {
      __ovPost({ type: "evaluated", id: id, ok: false, error: __ovErr(e2) });
      return;
    }
  }
  Promise.resolve()
    .then(function () {
      return fn();
    })
    .then(
      function (v) {
        var text = typeof v === "string" ? __ovText(JSON.stringify(v), __OV_EVAL_MAX__) : __ovText(v, __OV_EVAL_MAX__);
        __ovPost({ type: "evaluated", id: id, ok: true, text: text });
      },
      function (err) {
        __ovPost({ type: "evaluated", id: id, ok: false, error: __ovErr(err) });
      },
    );
}

self.onmessage = function (event) {
  var m = event.data;
  if (!m || typeof m !== "object") return;
  if (m.type === "reply") {
    var p = __ovPending.get(m.id);
    if (!p) return;
    __ovPending.delete(m.id);
    if (m.ok) p.resolve(m.value);
    else p.reject(__ovRebuild(m.error));
  } else if (m.type === "start") {
    __ovStart(m.id);
  } else if (m.type === "invoke") {
    __ovInvoke(m.id, m.menu);
  } else if (m.type === "eval") {
    __ovEval(m.id, String(m.code));
  }
};

self.addEventListener("error", function (event) {
  event.preventDefault();
  __ovPost({ type: "uncaught", error: { name: "Error", message: String(event.message), line: event.lineno || null } });
});

self.addEventListener("unhandledrejection", function (event) {
  event.preventDefault();
  __ovPost({ type: "uncaught", error: __ovErr(event.reason) });
});

__ovPost({ type: "ready" });
`;

/** What openvwx offers a worker: the names on openvwx.doc and openvwx.edit, and how much of an evaluated value comes back. */
export interface WorkerApi {
  readonly doc: readonly string[];
  readonly edit: readonly string[];
  /** characters of an evaluated value given back */
  readonly evalMax: number;
}

/** The plug-in API (API.md). The Agents panel's scripts are offered more. */
export const PLUGIN_API: WorkerApi = { doc: DOC_METHODS, edit: EDIT_METHODS, evalMax: 400 };

/**
 * The worker script for `userCode` (a plug-in's code), or for the script console
 * when it is null, offering `api`. The plug-in's code starts on the line after `offset`.
 */
export function workerSource(userCode: string | null, api: WorkerApi = PLUGIN_API): WorkerSource {
  const bootstrap = BOOTSTRAP.replace("__OV_DOC__", JSON.stringify(api.doc))
    .replace("__OV_EDIT__", JSON.stringify(api.edit))
    .replaceAll("__OV_EVAL_MAX__", String(api.evalMax))
    .replace("__OV_STUBS__", JSON.stringify(STUBBED));
  const wrap = userCode === null ? "\n" : "\nself.__ovEntry = async function () {\n";
  // the offset is a count of newlines, so writing it into the bootstrap does not move any line
  const offset = (bootstrap + wrap).split("\n").length - 1;
  const head = bootstrap.replace("__OV_OFFSET__", String(offset)) + wrap;
  const source = userCode === null ? head : head + userCode + "\n};\n";
  return { source, offset };
}
