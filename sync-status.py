"""Write STATUS.md's verification numbers, iterating to a fixed point.

Why this cannot be a single pass
--------------------------------
`test-app.cjs` asserts STATUS.md's own contents — the model and drug
counts, the preset count, the built file size, and that the headline check
total equals the sum of the per-suite table. So test-app's pass count
DEPENDS on STATUS.md, and STATUS.md's documented count depends on
test-app. Measure, write once, and you publish the count from before your
own edit: that is exactly how the table came to say test-app = 185 when
the suite actually reported 186 (writing the corrected file size flipped
that assertion from fail to pass, adding the check the table had just
been told about).

So: measure, write, re-measure, and repeat until the numbers stop moving.
Two iterations is the normal case; the loop is bounded because a
divergent oscillation means something else is wrong and should be loud
rather than silent.

Run after build.py and after rendering the deck (test-slides.cjs and
test-deck.cjs need slides-demo.html to exist, and test-app's count is
different without it).

    python sync-status.py            # write the numbers
    python sync-status.py --check    # verify only, non-zero on mismatch

`--check` is the release gate. The in-suite assertions check that the
headline equals the sum of STATUS.md's own table, which catches an
internally inconsistent document but NOT a table that is uniformly one
behind the real run — a test suite cannot cheaply audit its own aggregate
pass count, because reading it changes it.
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).parent
SUITES = ["test-core", "test-app", "test-layout", "validate",
          "test-slides", "test-deck"]


def measure():
    """Pass count per suite, from the suites' own output."""
    out = {}
    for s in SUITES:
        r = subprocess.run(["node", f"{s}.cjs"], cwd=ROOT,
                           capture_output=True, text=True)
        out[s] = sum(1 for ln in r.stdout.splitlines()
                     if ln.startswith("pass"))
        failed = [ln for ln in r.stdout.splitlines() if ln.startswith("FAIL")]
        if failed:
            out.setdefault("_failures", []).extend(f"{s}: {f}" for f in failed)
    return out


def write(counts):
    total = sum(v for k, v in counts.items() if not k.startswith("_"))
    kb = round((ROOT / "mipd-lab.html").stat().st_size / 1024)
    s = (ROOT / "STATUS.md").read_text()
    s = re.sub(r"\| Test checks passing \| \*\*\d+\*\*",
               f"| Test checks passing | **{total}**", s, count=1)
    s = re.sub(r"file, \d+ KB,", f"file, {kb} KB,", s, count=1)
    for k, v in counts.items():
        if k.startswith("_"):
            continue
        s, n = re.subn(rf"\| `{k}\.cjs` \| \d+ \|", f"| `{k}.cjs` | {v} |",
                       s, count=1)
        assert n == 1, f"no Verification row for {k}.cjs"
    (ROOT / "STATUS.md").write_text(s)
    return total, kb


CHECK = "--check" in sys.argv

if CHECK:
    c = measure()
    if c.get("_failures"):
        print("SUITE FAILURES:")
        for f in c["_failures"]:
            print("  " + f)
        sys.exit(1)
    live = {k: v for k, v in c.items() if not k.startswith("_")}
    total = sum(live.values())
    kb = round((ROOT / "mipd-lab.html").stat().st_size / 1024)
    doc = (ROOT / "STATUS.md").read_text()
    bad = []
    m = re.search(r"\| Test checks passing \| \*\*(\d+)\*\*", doc)
    if not m or int(m.group(1)) != total:
        bad.append(f"headline: document {m.group(1) if m else 'missing'} vs measured {total}")
    for k, v in live.items():
        mm = re.search(rf"\| `{k}\.cjs` \| (\d+) \|", doc)
        if not mm or int(mm.group(1)) != v:
            bad.append(f"{k}.cjs: document {mm.group(1) if mm else 'missing'} vs measured {v}")
    ms = re.search(r"file, (\d+) KB,", doc)
    if not ms or int(ms.group(1)) != kb:
        bad.append(f"file size: document {ms.group(1) if ms else 'missing'} KB vs measured {kb} KB")
    if bad:
        print("STATUS.md DOES NOT MATCH THE MEASURED RUN:")
        for b in bad:
            print("  " + b)
        print("run `python sync-status.py` to reconcile")
        sys.exit(1)
    print(f"STATUS.md matches the measured run: {total} checks across "
          f"{len(SUITES)} suites, {kb} KB")
    sys.exit(0)

prev = None
for it in range(1, 7):
    c = measure()
    # A failure in a STATUS.md-consistency assertion is the very thing this
    # script fixes, so it must not block the write — otherwise a stale
    # document deadlocks its own repair. Any OTHER failure is a real
    # regression and writing new numbers over it would launder it.
    real = [f for f in c.get("_failures", []) if "STATUS.md" not in f]
    if real:
        print("SUITE FAILURES unrelated to STATUS.md — not writing:")
        for f in real:
            print("  " + f)
        sys.exit(1)
    total, kb = write(c)
    shown = {k: v for k, v in c.items() if not k.startswith("_")}
    print(f"  pass {it}: {json.dumps(shown)} -> {total} checks, {kb} KB")
    if shown == prev:
        print(f"fixed point after {it} passes: {total} checks across "
              f"{len(SUITES)} suites, {kb} KB")
        break
    prev = shown
else:
    print("DID NOT CONVERGE — the documented counts oscillate; "
          "investigate before committing.")
    sys.exit(1)
