"""
Builds a single TypeScript file per Edge Function for the Supabase dashboard
editor, which can't import supabase/functions/_shared. Unlike an esbuild
bundle, the types are kept, so the editor shows no false errors.

    python3 scripts/bundle-functions.py odoo-gateway > dist-functions/odoo-gateway.ts
"""
import re, sys, os
base = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "supabase", "functions"))
IMPORT = re.compile(r'^import\s+(?:type\s+)?\{[^}]*\}\s+from\s+"(\.{1,2}/[^"]+)"\s*;?\s*\n', re.M)
NPM = re.compile(r'^import\s+[^\n]*from\s+"(npm:[^"]+|node:[^"]+|jsr:[^"]+)"\s*;?\s*\n', re.M)

def deps(path):
    src = open(path).read()
    return [os.path.normpath(os.path.join(os.path.dirname(path), m)) for m in IMPORT.findall(src)]

def order(entry):
    seen, out = set(), []
    def visit(p):
        if p in seen: return
        seen.add(p)
        for d in deps(p): visit(d)
        out.append(p)
    visit(entry)
    return out

fn = sys.argv[1]
entry = os.path.join(base, fn, "index.ts")
files = order(entry)
DECL = re.compile(r'^(export\s+)?(?:async\s+)?(?:function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)', re.M)

def declarations(src):
    return [(m.group(2), m.group(1) is not None) for m in DECL.finditer(src)]

sources = {f: open(f).read() for f in files}
owners = {}
for f, src in sources.items():
    for name, exported in declarations(src):
        owners.setdefault(name, []).append((f, exported))
# A private name declared in several modules is renamed in each module
# where it is private, so the single file has no duplicate declaration.
for name, places in owners.items():
    if len({f for f, _ in places}) < 2:
        continue
    for f, exported in places:
        if exported:
            continue
        tag = re.sub(r"\W", "_", os.path.splitext(os.path.relpath(f, base))[0])
        sources[f] = re.sub(rf"(?<![\w$.]){re.escape(name)}(?![\w$])", f"{name}__{tag}", sources[f])
        print(f"renamed {name} in {os.path.relpath(f, base)}", file=sys.stderr)

externals, bodies = [], []
for f in files:
    src = sources[f]
    for m in NPM.finditer(src):
        if m.group(0) not in externals: externals.append(m.group(0))
    src = NPM.sub("", IMPORT.sub("", src))
    rel = os.path.relpath(f, base)
    bodies.append(f"/* {'=' * 66} */\n/* {rel:<66} */\n/* {'=' * 66} */\n\n{src.strip()}\n")
header = (f"// {fn} — single-file build for the Supabase dashboard editor.\n"
          f"// Generated from supabase/functions/{fn}/index.ts and its _shared modules:\n"
          f"// edit the sources, then rebuild with scripts/bundle-functions.py.\n\n")
print(header + "".join(externals) + "\n" + "\n".join(bodies), end="")
print(" ".join(os.path.relpath(f, base) for f in files), file=sys.stderr)
