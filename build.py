"""Assemble the self-contained MIPD Lab HTML file.

The three JavaScript sources are inlined into shell.html so the result is a
single file with no external requests: that is what makes it usable inside a
Quarto/reveal.js deck served from disk, or from a USB stick in a lecture
theatre with no network.
"""
import pathlib

ROOT = pathlib.Path(".")
shell = (ROOT / "shell.html").read_text()

for marker, src in [
    ("<!--PKPD_CORE-->", "pkpd-core.js"),
    ("<!--PKPD_MODELS-->", "models.js"),
    ("<!--PKPD_APP-->", "app.js"),
]:
    code = (ROOT / src).read_text()
    assert "</script" not in code, f"{src} contains a script terminator"
    shell = shell.replace(marker, f"<script>\n{code}\n</script>")

assert "<!--PKPD" not in shell, "a marker was not substituted"
out = ROOT / "mipd-lab.html"
out.write_text(shell)
print(f"{out.name}  {out.stat().st_size:,} bytes")
