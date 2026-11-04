// Vectorscript, Vectorworks' Pascal, translated to Python that calls the vs module (vsModule.ts):
// the `_vsc` module the script worker imports for a .vs script. Procedures and functions become
// Python functions, nested as they are nested; each call's variables live in a frame object, so a
// nested routine reaches its parent's and a VAR argument is a reference to a variable, an array
// element or a record field. The vs calls that hand values back through VAR parameters (GetBBox,
// HCenter...) are given the variables to fill from what the Python call returns. Each line of the
// Python keeps the Vectorscript line it came from, for errors.

export const VSC_SOURCE = String.raw`
import copy as _copymod
import math as _m
import random as _rnd
import vs


class VsError(Exception):
    def __init__(self, message, line):
        Exception.__init__(self, message)
        self.line = line


# ---- what the translated script runs with -------------------------------------------------------

class _Frame(object):
    pass


class _Ref(object):
    __slots__ = ("o", "n")

    def __init__(self, o, n):
        self.o = o
        self.n = n

    def get(self):
        return getattr(self.o, self.n)

    def set(self, v):
        setattr(self.o, self.n, v)


class _IRef(object):
    __slots__ = ("o", "i")

    def __init__(self, o, i):
        self.o = o
        self.i = i

    def get(self):
        return self.o[self.i]

    def set(self, v):
        self.o[self.i] = v


class _Arr(object):
    """A Pascal array: indexed from its own lower bound, its elements made by make()."""

    def __init__(self, lo, hi, make):
        self.lo = int(lo)
        self.hi = int(hi)
        self.make = make
        self.items = [make() for _ in range(max(0, self.hi - self.lo + 1))]

    def _k(self, i):
        k = int(i) - self.lo
        if k < 0 or k >= len(self.items):
            raise IndexError("index %s is outside the array's %d..%d" % (i, self.lo, self.hi))
        return k

    def __getitem__(self, i):
        return self.items[self._k(i)]

    def __setitem__(self, i, v):
        self.items[self._k(i)] = v

    def __len__(self):
        return len(self.items)


class _Rec(object):
    def __init__(self, **fields):
        self.__dict__.update(fields)


def _alloc(make, dims):
    lo, hi = dims[0]
    if len(dims) == 1:
        return _Arr(lo, hi, make)
    return _Arr(lo, hi, lambda: _alloc(make, dims[1:]))


def _copy(v):
    return _copymod.deepcopy(v) if isinstance(v, (_Arr, _Rec)) else v


def _flat(v):
    if isinstance(v, (tuple, list)):
        out = []
        for x in v:
            out.extend(_flat(x))
        return out
    return [v]


def _idx(base, i):
    if isinstance(base, str):
        i = int(i)
        if i < 1 or i > len(base):
            raise IndexError("character %d is outside a string of %d" % (i, len(base)))
        return base[i - 1]
    return base[i]


def _setch(s, i, c):
    i = int(i)
    return s[:i - 1] + str(c) + s[i:]


def _isbool(v):
    return isinstance(v, bool)


def _and(a, b):
    if _isbool(a) or _isbool(b):
        return bool(a) and bool(b)
    return int(a) & int(b)


def _or(a, b):
    if _isbool(a) or _isbool(b):
        return bool(a) or bool(b)
    return int(a) | int(b)


def _not(a):
    return (not a) if _isbool(a) else ~int(a)


def _inset(v, *items):
    for it in items:
        if (len(it) == 2 and it[0] <= v <= it[1]) or (len(it) == 1 and v == it[0]):
            return True
    return False


def _div(a, b):
    q = abs(int(a)) // abs(int(b))
    return q if (a >= 0) == (b >= 0) else -q


def _mod(a, b):
    return int(a) - int(b) * _div(a, b)


def _len(mm):
    return mm / vs._S.U


def _text(v):
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float):
        return ("%.6f" % v).rstrip("0").rstrip(".")
    return str(v)


def _concat(*a):
    return "".join(_text(x) for x in a)


def _round(x):
    return int(_m.floor(abs(x) + 0.5)) * (1 if x >= 0 else -1)


def _substr(s, index, count):
    i = max(int(index), 1)
    return s[i - 1:i - 1 + max(int(count), 0)]


def _pos(sub, s):
    return s.find(sub) + 1


def _delete(s, index, count):
    i = int(index)
    return s[:i - 1] + s[i - 1 + int(count):]


def _insert(src, s, index):
    i = int(index)
    return s[:i - 1] + src + s[i - 1:]


class _Box(object):
    """A value a vs call hands a routine of the script for its VAR parameter."""

    __slots__ = ("v",)

    def __init__(self, v):
        self.v = v

    def get(self):
        return self.v

    def set(self, v):
        self.v = v


def _byref(fn, flags):
    """A routine of the script that a vs call calls back, its VAR arguments boxed: it returns what its first VAR argument holds after."""
    def call(*args):
        boxed = [_Box(a) if f else a for a, f in zip(args, flags)]
        fn(*boxed)
        held = [b.v for b, f in zip(boxed, flags) if f]
        return held[0] if held else None
    return call


def _spread(r, n):
    """A vs procedure's results for its n VAR arguments: as they come when there are n (a point to a VECTOR),
    else spread out (points to their x and y)."""
    if n == 1:
        return [r]
    r = list(r) if isinstance(r, (tuple, list)) else [r]
    return r if len(r) == n else _flat(r)


def _outs(r, refs):
    """A vs function that also fills VAR arguments: those set from its results after the first, which it returns."""
    r = list(r)
    for k, ref in enumerate(refs):
        ref.set(r[k + 1])
    return r[0]


def runtime():
    g = dict((k, v) for k, v in globals().items() if k.startswith("_") and not k.startswith("__"))
    g["vs"] = vs
    g["_m"] = _m
    g["_rnd"] = _rnd
    return g


# ---- names -------------------------------------------------------------------------------------

_KEYWORDS = set((
    "and array begin case const div do downto else end for function if in mod not of or otherwise "
    "procedure record repeat then to type until var while dynarray exit allocate"
).split())

# Pascal's own routines, as the runtime above has them
_BUILTINS = {
    "concat": "_concat", "len": "len", "copy": "_substr", "pos": "_pos", "chr": "chr", "ord": "ord",
    "round": "_round", "trunc": "int", "sqr": "(lambda x: x * x)", "sqrt": "_m.sqrt", "abs": "abs",
    "sin": "_m.sin", "cos": "_m.cos", "tan": "_m.tan", "arctan": "_m.atan", "arcsin": "_m.asin", "arccos": "_m.acos",
    "exp": "_m.exp", "ln": "_m.log", "deg2rad": "_m.radians", "rad2deg": "_m.degrees", "odd": "(lambda n: int(n) % 2 == 1)",
    "random": "_rnd.random",
}
# Pascal routines that change a VAR argument: the argument's position, and the function giving its new value
_BUILTIN_VAR = {
    "delete": (0, "_delete"), "insert": (1, "_insert"),
    "upperstring": (0, "(lambda s: s.upper())"), "lowerstring": (0, "(lambda s: s.lower())"),
    "uprstring": (0, "(lambda s: s.upper())"),
}
# vs procedures that hand values back through VAR parameters: how many come before them
_VS_OUT = {
    "colorindextorgb": 1, "getbbox": 1, "getfillback": 1, "getfillfore": 1, "getlocpt": 1, "getopacity": 1,
    "getpenback": 1, "getpenfore": 1, "getpolypt": 2, "getpolylinevertex": 2, "getsegpt1": 1, "getsegpt2": 1,
    "getclfillfore": 1, "getclfillback": 1, "getclpenfore": 1, "getclpenback": 1, "getclopacityn": 1, "getopacitybyclassn": 1,
    "ffillfore": 0, "ffillback": 0, "fpenfore": 0, "fpenback": 0, "getdefaultopacity": 0, "getdefaultopacityn": 0,
    "getzvals": 0, "getlayerelevation": 1, "gettextorientation": 1, "getarc": 1, "getrrdiam": 1,
    "getunits": 0, "hcenter": 1, "rgbtocolorindex": 3, "vsogeteventinfo": 0,
    "getpt": 0, "getline": 0, "getrect": 0,
    "getitemtext": 2, "getbooleanitem": 2, "getthreestatecheckboxstate": 2, "getchoicecount": 2, "getcolorchoice": 2,
    "getchoicetext": 3, "getchoiceindex": 3, "getselectedchoiceinfo": 3, "getselectedchoiceindex": 3,
}
# vs functions that also hand values back through their arguments: how many arguments come in
_VS_FN_OUT = {"getcustomobjectinfo": 0, "getplugininfo": 0, "geteditreal": 3, "geteditinteger": 2, "centroid": 1, "getopacityn": 1}
# vs procedures and functions with POINT arguments, which a script may pass as a point or as x and y, that
# hand values back through their last arguments: how many those are
_VS_OUT_LAST = {"linelineintersection": 3, "comp": 2, "unionrect": 2}
_VS_FN_OUT_LAST = {"circlecircleinters": 2, "linecircleintersect": 2}
# the text faces of Vectorscript's TEXTSTYLE sets
_FACES = {"bold": 1, "italic": 2, "underline": 4, "outline": 8, "shadow": 16}
_PARAM_TYPES = {"bool": ("bool",), "int": ("int",), "real": ("real",), "str": ("str",)}
# vs calls whose argument is search criteria written as they are, not as a string
_CRITERIA = {"count": 0, "foreachobject": 1, "selectobj": 0, "dselectobj": 0, "area": 0, "arean": 0, "perim": 0,
    "perimn": 0, "length": 0, "lengthn": 0, "width": 0, "height": 0, "xcenter": 0, "ycenter": 0, "xcentern": 0,
    "ycentern": 0, "leftbound": 0, "botbound": 0, "rightbound": 0, "topbound": 0, "leftboundn": 0, "botboundn": 0,
    "rightboundn": 0, "topboundn": 0, "angle": 0, "objecttype": 0}
# vs calls that take a procedure or function of the script
_CALLBACK = {"foreachobject": 0, "foreachobjectinlayer": 0, "foreachobjectinlist": 0, "runlayoutdialog": 1}

_INT = ("int",)
_REAL = ("real",)
_BOOL = ("bool",)
_STR = ("str",)
_HANDLE = ("handle",)
_SIMPLE_TYPES = {
    "integer": _INT, "longint": _INT, "word": _INT, "byte": _INT, "shortint": _INT,
    "real": _REAL, "extended": _REAL, "double": _REAL, "single": _REAL,
    "boolean": _BOOL, "string": _STR, "char": _STR, "handle": _HANDLE,
    "vector": ("rec", [("x", _REAL), ("y", _REAL), ("z", _REAL)]),
}


def _attr(name):
    return "v_" + name.lower()


# ---- the source as tokens ------------------------------------------------------------------------

def _lex(src):
    toks = []
    i, line, n = 0, 1, len(src)
    while i < n:
        c = src[i]
        if c == "\n":
            line += 1
            i += 1
        elif c.isspace():
            i += 1
        elif c == "{":
            j = src.find("}", i)
            if j < 0:
                raise VsError("a { comment isn't closed", line)
            if src[i + 1:i + 9].upper().startswith("$INCLUDE") or src[i + 1:i + 4].upper() == "$I ":
                raise VsError("{$INCLUDE} files aren't available in Rodeo", line)
            line += src.count("\n", i, j)
            i = j + 1
        elif src.startswith("(*", i):
            j = src.find("*)", i + 2)
            if j < 0:
                raise VsError("a (* comment isn't closed", line)
            line += src.count("\n", i, j)
            i = j + 2
        elif src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
        elif c.isdigit() or (c == "$" and i + 1 < n and src[i + 1] in "0123456789abcdefABCDEF"):
            i = _number(src, i, line, toks)
        elif c == "'" or c == "#":
            s, j = "", i
            while j < n and src[j] in "'#":
                if src[j] == "#":
                    k = j + 1
                    while k < n and src[k].isdigit():
                        k += 1
                    if k == j + 1:
                        raise VsError("# takes a character code", line)
                    s += chr(int(src[j + 1:k]))
                    j = k
                else:
                    k = j + 1
                    while True:
                        if k >= n or src[k] == "\n":
                            raise VsError("a string isn't closed", line)
                        if src[k] == "'":
                            if k + 1 < n and src[k + 1] == "'":
                                s += "'"
                                k += 2
                                continue
                            break
                        s += src[k]
                        k += 1
                    j = k + 1
            toks.append(("str", s, line, i, j))
            i = j
        elif c.isalpha() or c == "_":
            j = i
            while j < n and (src[j].isalnum() or src[j] == "_"):
                j += 1
            word = src[i:j]
            toks.append(("kw" if word.lower() in _KEYWORDS else "id", word.lower() if word.lower() in _KEYWORDS else word, line, i, j))
            i = j
        else:
            two = src[i:i + 2]
            if two in (":=", "..", "<=", ">=", "<>"):
                toks.append(("sym", two, line, i, i + 2))
                i += 2
            elif c in "+-*/=<>()[],;:.^@&|":
                toks.append(("sym", c, line, i, i + 1))
                i += 1
            else:
                raise VsError("unexpected character %r" % c, line)
    toks.append(("eof", None, line, n, n))
    return toks


def _number(src, i, line, toks):
    n = len(src)
    if src[i] == "$":
        j = i + 1
        while j < n and src[j] in "0123456789abcdefABCDEF":
            j += 1
        toks.append(("num", int(src[i + 1:j], 16), line, i, j))
        return j
    j = i
    while j < n and src[j].isdigit():
        j += 1
    real = False
    if j < n and src[j] == "." and not src.startswith("..", j):
        real = True
        j += 1
        while j < n and src[j].isdigit():
            j += 1
    if j < n and src[j] in "eE" and (src[j + 1:j + 2].isdigit() or (src[j + 1:j + 2] in "+-" and src[j + 2:j + 3].isdigit())):
        real = True
        j += 2
        while j < n and src[j].isdigit():
            j += 1
    v = float(src[i:j]) if real else int(src[i:j])
    # a length with its unit mark: 2" (inches), 3' (feet), 3'6" or 3'-6"
    if j < n and src[j] == '"':
        toks.append(("len", v * 25.4, line, i, j + 1))
        return j + 1
    if j < n and src[j] == "'":
        mm = v * 304.8
        k = j + 1
        if k < n and src[k] == "-":
            k += 1
        m = k
        while m < n and (src[m].isdigit() or src[m] == "."):
            m += 1
        if m > k and m < n and src[m] == '"':
            mm += float(src[k:m]) * 25.4
            j = m
        toks.append(("len", mm, line, i, j + 1))
        return j + 1
    toks.append(("num", v, line, i, j))
    return j


# ---- names in scope ------------------------------------------------------------------------------

class _Var(object):
    def __init__(self, name, typ, kind, depth):
        self.name = name
        self.typ = typ
        self.kind = kind  # var, const, param, ref
        self.depth = depth


class _Proc(object):
    def __init__(self, name, py, params, ret, depth, isfunc):
        self.name = name
        self.py = py
        self.params = params  # (lower name, is VAR, type)
        self.ret = ret
        self.depth = depth
        self.isfunc = isfunc
        self.forward = False


class _Scope(object):
    def __init__(self, parent, depth, proc=None):
        self.parent = parent
        self.depth = depth
        self.proc = proc
        self.names = {}

    def find(self, lname):
        s = self
        while s is not None:
            if lname in s.names:
                return s.names[lname]
            s = s.parent
        return None


# ---- the translator ------------------------------------------------------------------------------

class _Translator(object):
    def __init__(self, src):
        self.src = src
        self.toks = _lex(src)
        self.p = 0
        self.out = []
        self.ind = 0
        self.tmp = 0
        self.scope = _Scope(None, 0)
        self.vs_names = dict((n.lower(), n) for n in dir(vs) if n[:1].isupper() or n.startswith("vso"))
        self.top_procs = []
        self.ran = False

    # tokens
    def peek(self, k=0):
        return self.toks[min(self.p + k, len(self.toks) - 1)]

    def take(self):
        t = self.peek()
        self.p = min(self.p + 1, len(self.toks) - 1)
        return t

    def atkw(self, *words):
        t = self.peek()
        return t[0] == "kw" and t[1] in words

    def atsym(self, *syms):
        t = self.peek()
        return t[0] == "sym" and t[1] in syms

    def atid(self, word=None):
        t = self.peek()
        return t[0] == "id" and (word is None or t[1].lower() == word)

    def err(self, message, t=None):
        raise VsError(message, (t or self.peek())[2])

    def want_sym(self, s):
        if not self.atsym(s):
            self.err("expected %s, found %s" % (s, self.describe()))
        return self.take()

    def want_kw(self, w):
        if not self.atkw(w):
            self.err("expected %s, found %s" % (w.upper(), self.describe()))
        return self.take()

    def describe(self, t=None):
        t = t or self.peek()
        if t[0] == "eof":
            return "the end of the script"
        if t[0] == "str":
            return "'%s'" % t[1]
        return str(t[1]).upper() if t[0] == "kw" else str(t[1])

    def ident(self):
        t = self.take()
        if t[0] != "id":
            self.err("expected a name, found %s" % self.describe(t), t)
        return t

    def emit(self, text, line):
        self.out.append((self.ind, text, line))

    def temp(self):
        self.tmp += 1
        return "_t%d" % self.tmp

    def frame(self, depth):
        return "_f%d" % depth

    # the program
    def program(self):
        self.emit("_f0 = _Frame()", 1)
        while self.peek()[0] != "eof":
            if self.atkw("procedure", "function"):
                self.top_procs.append(self.routine())
            elif self.atkw("const", "var", "type"):
                self.declarations()
            elif self.atid("run"):
                t = self.take()
                self.want_sym("(")
                name = self.ident()
                self.want_sym(")")
                proc = self.scope.find(name[1].lower())
                if not isinstance(proc, _Proc):
                    self.err("RUN names %s, which isn't a procedure of the script" % name[1], name)
                self.emit("%s()" % proc.py, t[2])
                self.ran = True
            elif self.atkw("begin"):
                self.take()
                self.statements_until("end")
                self.take()
                self.ran = True
            elif self.atsym(";", "."):
                self.take()
            else:
                self.err("expected PROCEDURE, FUNCTION or RUN, found %s" % self.describe())
        if not self.ran:
            procs = [p for p in self.top_procs if not p.forward]
            if len(procs) == 1:
                self.emit("%s()" % procs[0].py, self.peek()[2])
            else:
                self.err("the script has no RUN(...) naming the procedure to run")

    def declarations(self):
        while True:
            if self.atkw("const"):
                self.take()
                while self.atid():
                    t = self.ident()
                    typ = None
                    if self.atsym(":"):
                        self.take()
                        typ = self.type_()
                    self.want_sym("=")
                    code, etyp = self.expr()
                    self.want_sym(";")
                    self.declare(t, typ or etyp, "const", code)
            elif self.atkw("var"):
                self.take()
                while self.atid():
                    names = [self.ident()]
                    while self.atsym(","):
                        self.take()
                        names.append(self.ident())
                    self.want_sym(":")
                    typ = self.type_()
                    self.want_sym(";")
                    for t in names:
                        self.declare(t, typ, "var", self.default(typ))
            elif self.atkw("type"):
                self.take()
                while self.atid():
                    t = self.ident()
                    self.want_sym("=")
                    typ = self.type_()
                    self.want_sym(";")
                    self.scope.names[t[1].lower()] = ("type", typ)
            else:
                return

    def declare(self, t, typ, kind, code):
        lname = t[1].lower()
        self.scope.names[lname] = _Var(lname, typ, kind, self.scope.depth)
        self.emit("%s.%s = %s" % (self.frame(self.scope.depth), _attr(lname), code), t[2])

    def type_(self):
        if self.atkw("array"):
            self.take()
            self.want_sym("[")
            dims = []
            while True:
                lo, _ = self.expr()
                self.want_sym("..")
                hi, _ = self.expr()
                dims.append((lo, hi))
                if not self.atsym(","):
                    break
                self.take()
            self.want_sym("]")
            self.want_kw("of")
            typ = self.type_()
            for lo, hi in reversed(dims):
                typ = ("array", lo, hi, typ)
            return typ
        if self.atkw("dynarray"):
            self.take()
            self.want_sym("[")
            ndims = 1
            while not self.atsym("]"):
                if self.atsym(","):
                    ndims += 1
                self.take()
            self.take()
            self.want_kw("of")
            if ndims == 1 and self.atid("char"):
                # DYNARRAY[] OF CHAR is Vectorscript's long string
                self.take()
                return _STR
            return ("dyn", ndims, self.type_())
        if self.atkw("record"):
            self.take()
            fields = []
            while not self.atkw("end"):
                names = [self.ident()]
                while self.atsym(","):
                    self.take()
                    names.append(self.ident())
                self.want_sym(":")
                ftyp = self.type_()
                fields.extend((n[1].lower(), ftyp) for n in names)
                if self.atsym(";"):
                    self.take()
            self.take()
            return ("rec", fields)
        t = self.ident()
        lname = t[1].lower()
        if lname == "string" and self.atsym("["):
            while not self.atsym("]"):
                self.take()
            self.take()
        if lname in _SIMPLE_TYPES:
            return _SIMPLE_TYPES[lname]
        found = self.scope.find(lname)
        if isinstance(found, tuple) and found[0] == "type":
            return found[1]
        self.err("unknown type %s" % t[1], t)

    def default(self, typ):
        if typ is None:
            return "None"
        k = typ[0]
        if k == "int":
            return "0"
        if k == "real":
            return "0.0"
        if k == "bool":
            return "False"
        if k == "str":
            return "''"
        if k == "handle":
            return "None"
        if k == "array":
            return "_Arr(%s, %s, lambda: %s)" % (typ[1], typ[2], self.default(typ[3]))
        if k == "dyn":
            return "_Arr(1, 0, lambda: %s)" % self.default(typ[2])
        if k == "rec":
            return "_Rec(%s)" % ", ".join("%s=%s" % (_attr(f), self.default(ft)) for f, ft in typ[1])
        return "None"

    def copy_if(self, typ, code):
        return "_copy(%s)" % code if typ and typ[0] in ("array", "rec", "dyn") else code

    def routine(self):
        isfunc = self.take()[1] == "function"
        t = self.ident()
        lname = t[1].lower()
        params = []
        if self.atsym("("):
            self.take()
            while not self.atsym(")"):
                isvar = False
                if self.atkw("var"):
                    self.take()
                    isvar = True
                names = [self.ident()]
                while self.atsym(","):
                    self.take()
                    names.append(self.ident())
                self.want_sym(":")
                ptyp = self.type_()
                params.extend((n[1].lower(), isvar, ptyp) for n in names)
                if self.atsym(";"):
                    self.take()
            self.take()
        ret = None
        if isfunc and self.atsym(":"):
            self.take()
            ret = self.type_()
        self.want_sym(";")
        depth = self.scope.depth + 1
        early = self.scope.names.get(lname)
        if isinstance(early, _Proc) and early.forward and not params and ret is None:
            # the body of a FORWARD declaration, which may leave its parameters out
            params, ret = early.params, early.ret
        proc = _Proc(t[1], "p_" + lname, params, ret, depth, isfunc)
        self.scope.names[lname] = proc
        if self.atid("forward"):
            # declared now, its body further on: Python finds it when it is called
            self.take()
            self.want_sym(";")
            proc.forward = True
            return proc
        self.emit("def %s(%s):" % (proc.py, ", ".join("a_" + n for n, _, _ in params)), t[2])
        self.ind += 1
        self.scope = _Scope(self.scope, depth, proc)
        f = self.frame(depth)
        self.emit("%s = _Frame()" % f, t[2])
        for n, isvar, ptyp in params:
            self.scope.names[n] = _Var(n, ptyp, "ref" if isvar else "param", depth)
            self.emit("%s.%s = %s" % (f, _attr(n), "a_" + n if isvar else self.copy_if(ptyp, "a_" + n)), t[2])
        if isfunc:
            self.emit("%s._result = %s" % (f, self.default(ret)), t[2])
        while True:
            if self.atkw("procedure", "function"):
                self.routine()
            elif self.atkw("const", "var", "type"):
                self.declarations()
            else:
                break
        self.want_kw("begin")
        self.statements_until("end")
        end = self.take()
        self.emit("return %s._result" % f if isfunc else "return None", end[2])
        if self.atsym(";", "."):
            self.take()
        self.scope = self.scope.parent
        self.ind -= 1
        return proc

    # statements
    def statements_until(self, *words):
        while not self.atkw(*words):
            if self.peek()[0] == "eof":
                self.err("expected %s before the end of the script" % " or ".join(w.upper() for w in words))
            if self.atsym(";"):
                self.take()
                continue
            self.statement()
            if not self.atsym(";") and not self.atkw(*words):
                # a missing ; is reported on the line it is missing from
                self.err("expected ; after the statement, found %s" % self.describe(), self.toks[self.p - 1])

    def body(self):
        """One statement as the body of if, while, for or a case branch: pass when it is empty."""
        n = len(self.out)
        line = self.peek()[2]
        self.ind += 1
        if not self.atsym(";") and not self.atkw("end", "else", "until", "otherwise"):
            self.statement()
        if len(self.out) == n:
            self.emit("pass", line)
        self.ind -= 1

    def statement(self):
        t = self.peek()
        line = t[2]
        if self.atkw("begin"):
            self.take()
            n = len(self.out)
            self.statements_until("end")
            self.take()
            if len(self.out) == n:
                self.emit("pass", line)
        elif self.atkw("if"):
            self.take()
            cond, _ = self.expr()
            self.want_kw("then")
            self.emit("if %s:" % cond, line)
            self.body()
            if self.atkw("else"):
                self.emit("else:", self.take()[2])
                self.body()
        elif self.atkw("while"):
            self.take()
            cond, _ = self.expr()
            self.want_kw("do")
            self.emit("while %s:" % cond, line)
            self.body()
        elif self.atkw("repeat"):
            self.take()
            self.emit("while True:", line)
            self.ind += 1
            self.statements_until("until")
            u = self.take()
            cond, _ = self.expr()
            self.emit("if %s:" % cond, u[2])
            self.emit("    break", u[2])
            self.ind -= 1
        elif self.atkw("for"):
            self.take()
            v = self.ident()
            lv = self.lvalue(v)
            self.want_sym(":=")
            a, _ = self.expr()
            down = self.take()
            if down[0] != "kw" or down[1] not in ("to", "downto"):
                self.err("expected TO or DOWNTO", down)
            b, _ = self.expr()
            self.want_kw("do")
            i = self.temp()
            if down[1] == "to":
                self.emit("for %s in range(int(%s), int(%s) + 1):" % (i, a, b), line)
            else:
                self.emit("for %s in range(int(%s), int(%s) - 1, -1):" % (i, a, b), line)
            self.ind += 1
            self.emit(self.set(lv, i), line)
            self.ind -= 1
            self.body()
        elif self.atkw("case"):
            self.case_()
        elif self.atkw("exit"):
            self.take()
            if self.atsym("("):
                self.take()
                self.want_sym(")")
            proc = self.scope.proc
            if proc is None:
                self.err("EXIT outside a procedure", t)
            self.emit("return %s._result" % self.frame(proc.depth) if proc.isfunc else "return None", line)
        elif self.atkw("allocate"):
            self.take()
            v = self.ident()
            var = self.scope.find(v[1].lower())
            if not isinstance(var, _Var) or not var.typ or var.typ[0] != "dyn":
                self.err("ALLOCATE takes a DYNARRAY variable", v)
            self.want_sym("[")
            dims = []
            while True:
                lo, _ = self.expr()
                self.want_sym("..")
                hi, _ = self.expr()
                dims.append("(%s, %s)" % (lo, hi))
                if not self.atsym(","):
                    break
                self.take()
            self.want_sym("]")
            make = "lambda: %s" % self.default(var.typ[2])
            self.emit(self.set((var, [], var.typ), "_alloc(%s, [%s])" % (make, ", ".join(dims))), line)
        elif t[0] == "id" and t[1].lower() in ("with", "goto") and self.scope.find(t[1].lower()) is None:
            self.err("%s isn't available in Rodeo's Vectorscript" % t[1].upper(), t)
        elif t[0] == "id":
            self.take()
            lname = t[1].lower()
            found = self.scope.find(lname)
            assigning = self.atsym(":=", "[", ".") or (isinstance(found, _Proc) and found.isfunc and self.atsym(":=") )
            if assigning and not (isinstance(found, _Proc) and not self.atsym(":=")):
                lv = self.lvalue(t)
                self.want_sym(":=")
                code, typ = self.expr()
                self.emit(self.set(lv, self.copy_if(typ, code)), line)
            else:
                self.call_statement(t)
        else:
            self.err("unexpected %s" % self.describe(t), t)

    def case_(self):
        line = self.take()[2]
        sel, _ = self.expr()
        self.want_kw("of")
        c = self.temp()
        self.emit("%s = %s" % (c, sel), line)
        first = True
        while not self.atkw("end", "otherwise", "else"):
            if self.atsym(";"):
                self.take()
                continue
            conds = []
            lline = self.peek()[2]
            while True:
                a, _ = self.expr()
                if self.atsym(".."):
                    self.take()
                    b, _ = self.expr()
                    conds.append("%s <= %s <= %s" % (a, c, b))
                else:
                    conds.append("%s == %s" % (c, a))
                if not self.atsym(","):
                    break
                self.take()
            self.want_sym(":")
            self.emit("%s %s:" % ("if" if first else "elif", " or ".join(conds)), lline)
            first = False
            self.body()
        if self.atkw("otherwise", "else"):
            o = self.take()
            self.emit("else:" if not first else "if True:", o[2])
            self.ind += 1
            n = len(self.out)
            self.statements_until("end")
            if len(self.out) == n:
                self.emit("pass", o[2])
            self.ind -= 1
        self.want_kw("end")

    # variables
    def lvalue(self, t):
        """A variable (or a function's result) with its indexes and fields: (base, selectors, type)."""
        lname = t[1].lower()
        found = self.scope.find(lname)
        if isinstance(found, _Proc) and found.isfunc and self.inside(found):
            base, typ = ("result", found), found.ret
        elif isinstance(found, _Var):
            if found.kind == "const":
                self.err("%s is a constant" % t[1], t)
            base, typ = found, found.typ
        elif found is None:
            self.err("%s isn't declared" % t[1], t)
        else:
            self.err("%s can't be assigned to" % t[1], t)
        sels = []
        while self.atsym("[", "."):
            if self.take()[1] == "[":
                while True:
                    i, _ = self.expr()
                    sels.append(("idx", i, typ))
                    typ = typ[3] if typ and typ[0] == "array" else (typ[2] if typ and typ[0] == "dyn" else (_STR if typ == _STR else None))
                    if not self.atsym(","):
                        break
                    self.take()
                self.want_sym("]")
            else:
                f = self.ident()[1].lower()
                sels.append(("field", f, typ))
                typ = dict(typ[1]).get(f) if typ and typ[0] == "rec" else None
        return (base, sels, typ)

    def inside(self, proc):
        s = self.scope
        while s is not None:
            if s.proc is proc:
                return True
            s = s.parent
        return False

    def base_get(self, base):
        if isinstance(base, tuple):
            return "%s._result" % self.frame(base[1].depth)
        code = "%s.%s" % (self.frame(base.depth), _attr(base.name))
        return code + ".get()" if base.kind == "ref" else code

    def get(self, lv):
        base, sels, _ = lv
        code = self.base_get(base)
        for kind, v, typ in sels:
            if kind == "field":
                code = "%s.%s" % (code, _attr(v))
            elif typ and typ[0] in ("array", "dyn"):
                code = "%s[%s]" % (code, v)
            else:
                code = "_idx(%s, %s)" % (code, v)
        return code

    def set(self, lv, value):
        base, sels, _ = lv
        if not sels:
            if isinstance(base, tuple):
                return "%s._result = %s" % (self.frame(base[1].depth), value)
            code = "%s.%s" % (self.frame(base.depth), _attr(base.name))
            return "%s.set(%s)" % (code, value) if base.kind == "ref" else "%s = %s" % (code, value)
        prefix = (base, sels[:-1], None)
        kind, v, typ = sels[-1]
        if kind == "field":
            return "%s.%s = %s" % (self.get(prefix), _attr(v), value)
        if typ == _STR:
            return self.set(prefix, "_setch(%s, %s, %s)" % (self.get(prefix), v, value))
        return "%s[%s] = %s" % (self.get(prefix), v, value)

    def ref(self, lv):
        base, sels, _ = lv
        if not sels:
            if isinstance(base, tuple):
                return "_Ref(%s, '_result')" % self.frame(base[1].depth)
            code = "%s.%s" % (self.frame(base.depth), _attr(base.name))
            return code if base.kind == "ref" else "_Ref(%s, '%s')" % (self.frame(base.depth), _attr(base.name))
        prefix = (base, sels[:-1], None)
        kind, v, typ = sels[-1]
        if kind == "field":
            return "_Ref(%s, '%s')" % (self.get(prefix), _attr(v))
        if typ == _STR:
            self.err("a character of a string can't be a VAR argument")
        return "_IRef(%s, %s)" % (self.get(prefix), v)

    # calls
    def call_statement(self, t):
        lname = t[1].lower()
        found = self.scope.find(lname)
        line = t[2]
        if isinstance(found, _Proc):
            self.emit(self.user_call(found, t), line)
            return
        if isinstance(found, _Var):
            self.err("%s is a variable: assign with :=" % t[1], t)
        if lname in _VS_OUT or lname in _VS_OUT_LAST:
            n_in = _VS_OUT[lname] if lname in _VS_OUT else self.arg_count() - _VS_OUT_LAST[lname]
            args = self.ext_args(lname, set(range(n_in, 99)))
            ins = [a for a in args[:n_in]]
            outs = args[n_in:]
            if any(not isinstance(o, tuple) for o in outs):
                self.err("%s hands values back through its last arguments, which must be variables" % t[1], t)
            o = self.temp()
            self.emit("%s = _spread(vs.%s(%s), %d)" % (o, self.vs_names.get(lname, t[1]), ", ".join(ins), len(outs)), line)
            for k, lv in enumerate(outs):
                self.emit(self.set(lv, "%s[%d]" % (o, k)), line)
            return
        if lname in _VS_FN_OUT or lname in _VS_FN_OUT_LAST:
            self.emit(self.fn_out_call(t, lname), line)
            return
        if lname in _BUILTIN_VAR:
            pos, fn = _BUILTIN_VAR[lname]
            args = self.ext_args(lname, set([pos]))
            if len(args) <= pos or not isinstance(args[pos], tuple):
                self.err("%s changes its argument %d, which must be a variable" % (t[1], pos + 1), t)
            lv = args[pos]
            vals = [self.get(a) if isinstance(a, tuple) else a for a in args]
            self.emit(self.set(lv, "%s(%s)" % (fn, ", ".join(vals))), line)
            return
        self.emit(self.ext_call(t, lname), line)

    def user_call(self, proc, t):
        args = []
        if self.atsym("("):
            self.take()
            i = 0
            while not self.atsym(")"):
                if i < len(proc.params) and proc.params[i][1]:
                    v = self.ident()
                    args.append(self.ref(self.lvalue(v)))
                else:
                    code, _ = self.expr()
                    ptyp = proc.params[i][2] if i < len(proc.params) else None
                    args.append(self.copy_if(ptyp, code))
                i += 1
                if self.atsym(","):
                    self.take()
                elif not self.atsym(")"):
                    self.err("expected , or ) in the arguments of %s" % proc.name)
            self.take()
        if len(args) != len(proc.params):
            self.err("%s takes %d argument%s, not %d" % (proc.name, len(proc.params), "" if len(proc.params) == 1 else "s", len(args)), t)
        return "%s(%s)" % (proc.py, ", ".join(args))

    def ext_args(self, lname, lvalue_at=()):
        """The arguments of a vs or Pascal call: code, or (for those it fills) an lvalue tuple."""
        args = []
        if not self.atsym("("):
            return args
        self.take()
        i = 0
        while not self.atsym(")"):
            if _CRITERIA.get(lname) == i and self.raw_criteria():
                args.append(repr(self.raw_arg()))
            elif _CALLBACK.get(lname) == i and self.atid() and isinstance(self.scope.find(self.peek()[1].lower()), _Proc):
                proc = self.scope.find(self.take()[1].lower())
                flags = [bool(p[1]) for p in proc.params]
                # a dialog handler's VAR item: the vs call hands it in and gets back what the handler left in it
                args.append("_byref(%s, %r)" % (proc.py, flags) if any(flags) else proc.py)
            elif i in lvalue_at:
                args.append(self.lvalue(self.ident()))
            else:
                args.append(self.expr()[0])
            i += 1
            if self.atsym(","):
                self.take()
            elif not self.atsym(")"):
                self.err("expected , or ) in the arguments")
        self.take()
        return args

    def arg_tokens(self):
        depth, k = 0, self.p
        while True:
            t = self.toks[k]
            if t[0] == "eof":
                self.err("a call's ( isn't closed")
            if t[0] == "sym" and t[1] in "([":
                depth += 1
            elif t[0] == "sym" and t[1] in ")]":
                if depth == 0:
                    break
                depth -= 1
            elif t[0] == "sym" and t[1] == "," and depth == 0:
                break
            k += 1
        return self.toks[self.p:k]

    def raw_criteria(self):
        """Criteria written out, as ((T=RECT) & (SEL=TRUE)): not a string, a variable or a Concat."""
        toks = self.arg_tokens()
        if len(toks) == 1 and (toks[0][0] == "str" or (toks[0][0] == "id" and isinstance(self.scope.find(toks[0][1].lower()), _Var))):
            return False
        if toks and toks[0][0] == "id" and toks[0][1].lower() == "concat":
            return False
        return True

    def raw_arg(self):
        toks = self.arg_tokens()
        self.p += len(toks)
        return self.src[toks[0][3]:toks[-1][4]] if toks else ""

    def arg_count(self):
        """How many arguments the call about to be read has, counted ahead without reading them."""
        if not self.atsym("("):
            return 0
        depth, n, k = 0, 0, 0
        while True:
            tk = self.peek(k)
            if tk[0] == "eof":
                return n
            if tk[0] == "sym" and tk[1] in ("(", "["):
                depth += 1
            elif tk[0] == "sym" and tk[1] in (")", "]"):
                depth -= 1
                if depth == 0:
                    return n + (0 if k == 1 else 1)
            elif depth == 1 and tk[0] == "sym" and tk[1] == ",":
                n += 1
            k += 1

    def fn_out_call(self, t, lname):
        n_in = _VS_FN_OUT[lname] if lname in _VS_FN_OUT else self.arg_count() - _VS_FN_OUT_LAST[lname]
        args = self.ext_args(lname, set(range(n_in, 99)))
        outs = args[n_in:]
        if any(not isinstance(o, tuple) for o in outs):
            self.err("%s hands values back through its last arguments, which must be variables" % t[1], t)
        return "_outs(vs.%s(%s), [%s])" % (self.vs_names.get(lname, t[1]), ", ".join(args[:n_in]), ", ".join(self.ref(o) for o in outs))

    def ext_call(self, t, lname):
        args = self.ext_args(lname)
        if lname in _BUILTINS and not isinstance(self.scope.find(lname), _Var):
            return "%s(%s)" % (_BUILTINS[lname], ", ".join(args))
        if lname == "message":
            # Vectorscript's Message writes numbers and booleans its own way: 5, TRUE
            return "vs.Message(_concat(%s))" % ", ".join(args)
        return "vs.%s(%s)" % (self.vs_names.get(lname, t[1]), ", ".join(args))

    # expressions: (code, type)
    def expr(self):
        a, ta = self.simple()
        if self.atkw("in"):
            self.take()
            self.want_sym("[")
            items = []
            while not self.atsym("]"):
                x, _ = self.expr()
                if self.atsym(".."):
                    self.take()
                    y, _ = self.expr()
                    items.append("(%s, %s)" % (x, y))
                else:
                    items.append("(%s,)" % x)
                if self.atsym(","):
                    self.take()
            self.take()
            return "_inset(%s%s)" % (a, "".join(", " + i for i in items)), _BOOL
        if self.atsym("=", "<>", "<", ">", "<=", ">="):
            op = self.take()[1]
            b, _ = self.simple()
            return "(%s %s %s)" % (a, {"=": "==", "<>": "!="}.get(op, op), b), _BOOL
        return a, ta

    def simple(self):
        neg = False
        if self.atsym("-", "+"):
            neg = self.take()[1] == "-"
        a, ta = self.term()
        if neg:
            a = "(-%s)" % a
        while self.atsym("+", "-") or self.atkw("or"):
            op = self.take()[1]
            b, tb = self.term()
            if op == "or":
                # booleans stop at the first true side, as a test like (h = NIL) OR (GetType(h) = 3) needs
                if _BOOL in (ta, tb):
                    a, ta = "(bool(%s) or bool(%s))" % (a, b), _BOOL
                else:
                    a = "_or(%s, %s)" % (a, b)
            else:
                a = "(%s %s %s)" % (a, op, b)
                ta = _STR if _STR in (ta, tb) else (_REAL if _REAL in (ta, tb) else ta)
        return a, ta

    def term(self):
        a, ta = self.factor()
        while self.atsym("*", "/") or self.atkw("div", "mod", "and"):
            op = self.take()[1]
            b, tb = self.factor()
            if op == "and":
                if _BOOL in (ta, tb):
                    a, ta = "(bool(%s) and bool(%s))" % (a, b), _BOOL
                else:
                    a = "_and(%s, %s)" % (a, b)
            elif op == "div":
                a, ta = "_div(%s, %s)" % (a, b), _INT
            elif op == "mod":
                a, ta = "_mod(%s, %s)" % (a, b), _INT
            elif op == "/":
                a, ta = "(%s / %s)" % (a, b), _REAL
            else:
                a, ta = "(%s * %s)" % (a, b), (_REAL if _REAL in (ta, tb) else ta)
        return a, ta

    def factor(self):
        t = self.peek()
        if t[0] == "num":
            self.take()
            return repr(t[1]), (_REAL if isinstance(t[1], float) else _INT)
        if t[0] == "len":
            self.take()
            return "_len(%r)" % t[1], _REAL
        if t[0] == "str":
            self.take()
            return repr(t[1]), _STR
        if self.atsym("("):
            self.take()
            code, typ = self.expr()
            self.want_sym(")")
            return "(%s)" % code, typ
        if self.atsym("["):
            # a set: Vectorscript's text faces, [Bold, Italic], as their bits
            self.take()
            items = []
            while not self.atsym("]"):
                items.append(self.expr()[0])
                if self.atsym(","):
                    self.take()
            self.take()
            return "(%s)" % " | ".join(["0"] + items), _INT
        if self.atkw("not"):
            self.take()
            code, typ = self.factor()
            return ("(not %s)" % code if typ == _BOOL else "_not(%s)" % code), typ
        if t[0] == "id":
            return self.name_expr()
        self.err("unexpected %s in an expression" % self.describe(t), t)

    def name_expr(self):
        t = self.take()
        lname = t[1].lower()
        found = self.scope.find(lname)
        if isinstance(found, _Var):
            if found.kind == "const" and not self.atsym("[", "."):
                return "%s.%s" % (self.frame(found.depth), _attr(lname)), found.typ
            self.p -= 1
            lv = self.lvalue(self.take()) if found.kind != "const" else None
            if lv is None:
                self.err("a constant has no indexes or fields", t)
            return self.get(lv), lv[2]
        if isinstance(found, _Proc):
            return self.user_call(found, t), found.ret
        if found is None and not self.atsym("("):
            if lname == "true":
                return "True", _BOOL
            if lname == "false":
                return "False", _BOOL
            if lname == "nil":
                return "None", _HANDLE
            if lname == "pi":
                return "_m.pi", _REAL
            if lname in _FACES:
                return str(_FACES[lname]), _INT
            # a parameter of the plug-in running: P and its name
            ptype = vs._param_type(lname[1:]) if lname[:1] == "p" else None
            if ptype:
                return "vs._param(%r)" % lname[1:], _PARAM_TYPES[ptype]
        if lname in _VS_FN_OUT or lname in _VS_FN_OUT_LAST:
            return self.fn_out_call(t, lname), _BOOL
        if lname in _VS_OUT or lname in _VS_OUT_LAST or lname in _BUILTIN_VAR:
            self.err("%s hands values back through its arguments: call it as a statement" % t[1], t)
        typ = _STR if lname in ("concat", "copy", "chr", "num2str", "getname", "getclass", "getlname", "gettext", "strdialog", "getfontname") else None
        return self.ext_call(t, lname), typ


def translate(src):
    """Python for a Vectorscript, and the Vectorscript line of each of its lines."""
    tr = _Translator(src)
    tr.program()
    lines = []
    where = []
    for ind, text, line in tr.out:
        lines.append("    " * ind + text)
        where.append(line)
    return "\n".join(lines) + "\n", where
`;
