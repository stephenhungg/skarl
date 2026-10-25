"""Check repository-relative Markdown links and anchors without network requests."""
from pathlib import Path
import re
import sys
import unicodedata

root = Path(__file__).resolve().parents[1]
skipped_dirs = {"node_modules", ".venv", ".git", ".next", ".pytest_cache", "work"}
inline_link = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
reference_link = re.compile(r"^\s*\[[^\]]+\]:\s*(\S+)", re.MULTILINE)
html_link = re.compile(r"<a\s[^>]*href=\"([^\"]+)\"", re.IGNORECASE)
heading = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$", re.MULTILINE)
fence = re.compile(r"^```.*?^```", re.MULTILINE | re.DOTALL)


def slugify(text: str) -> str:
    """Approximate GitHub's heading anchor algorithm."""
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"[^\w\- ]", "", text)
    return text.replace(" ", "-")


def anchors_for(path: Path, cache: dict[Path, set[str]]) -> set[str]:
    if path not in cache:
        text = fence.sub("", path.read_text())
        seen: dict[str, int] = {}
        anchors: set[str] = set()
        for title in heading.findall(text):
            slug = slugify(title)
            count = seen.get(slug, 0)
            anchors.add(slug if count == 0 else f"{slug}-{count}")
            seen[slug] = count + 1
        cache[path] = anchors
    return cache[path]


files = sorted(
    path
    for path in root.rglob("*.md")
    if not skipped_dirs.intersection(path.relative_to(root).parts)
)
errors: list[str] = []
anchor_cache: dict[Path, set[str]] = {}
for file in files:
    text = fence.sub("", file.read_text())
    targets = inline_link.findall(text) + reference_link.findall(text) + html_link.findall(text)
    for raw_target in targets:
        target = raw_target.strip("<>")
        if not target or "://" in target or target.startswith("mailto:"):
            continue
        path_part, _, anchor = target.partition("#")
        path = (file.parent / path_part).resolve() if path_part else file
        label = f"{file.relative_to(root)}: {target}"
        if not path.is_relative_to(root) or not path.exists():
            errors.append(f"{label} (missing file)")
        elif anchor and path.suffix == ".md" and anchor.lower() not in anchors_for(path, anchor_cache):
            errors.append(f"{label} (missing anchor)")
if errors:
    print("\n".join(errors))
    sys.exit(1)
print(f"Checked local links and anchors in {len(files)} Markdown files")
