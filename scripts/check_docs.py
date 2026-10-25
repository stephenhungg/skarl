"""Check repository-relative Markdown links without network requests."""
from pathlib import Path
import re
import sys
root = Path(__file__).resolve().parents[1]
errors = []
files = [root / "README.md", root / "AGENTS.md"] + list((root / "docs").glob("*.md"))
for file in files:
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", file.read_text()):
        target = target.split("#", 1)[0].strip("<>")
        if not target or "://" in target or target.startswith("mailto:"):
            continue
        path = (file.parent / target).resolve()
        if not path.is_relative_to(root) or not path.exists():
            errors.append(f"{file.relative_to(root)}: broken local link {target}")
if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"Checked local links in {len(files)} documentation files")
