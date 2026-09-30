#!/usr/bin/env python3
"""Copy the editable text in text/*.txt into index.html.

Each text file is named after a slide (1_title.txt -> "title") and holds
blocks that start with a [name] line. index.html marks where each block
goes:

    <!-- txt:title.caption:inline --> ... <!-- /txt -->
    <!-- txt:signal.body --> ... <!-- /txt -->

Text format inside a block:
    - Line breaks are only for readability; wrapped lines are joined.
    - A blank line starts a new paragraph.
    - A line starting with "- " starts a bullet point.
    - Inline HTML and entities (&times;, &nbsp;, <a href=...>) pass through.

Inline markers get the text as-is; the others get <p> and <ul> markup.

Usage: python3 build_text.py   (run from anywhere, then reload the page)
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HTML = HERE / 'index.html'
TEXT_DIR = HERE / 'text'

MARKER = re.compile(
    r'(?P<indent>[ \t]*)(?P<open><!-- txt:(?P<key>[\w.-]+?)(?P<inline>:inline)? -->)'
    r'.*?(?P<close><!-- /txt -->)', re.S)


def load_blocks():
    blocks = {}
    for path in sorted(TEXT_DIR.glob('*.txt')):
        slide = re.sub(r'^\d+_', '', path.stem)
        name = None
        for line in path.read_text(encoding='utf-8').splitlines():
            m = re.match(r'^\[([\w-]+)\]\s*$', line)
            if m:
                name = slide + '.' + m.group(1)
                blocks[name] = []
            elif name:
                blocks[name].append(line.rstrip())
    return blocks


def paragraphs(lines):
    """Split into groups: ('p', text) or ('ul', [items])."""
    groups = []
    current = None   # the text list being appended to
    for line in lines + ['']:
        stripped = line.strip()
        if not stripped:
            current = None
        elif stripped.startswith('- '):
            if not (groups and groups[-1][0] == 'ul' and current is not None):
                groups.append(('ul', []))
            groups[-1][1].append([stripped[2:]])
            current = groups[-1][1][-1]
        elif current is not None:
            current.append(stripped)
        else:
            groups.append(('p', [stripped]))
            current = groups[-1][1]
    return groups


def render(lines, inline, indent):
    if inline:
        return ' '.join(l.strip() for l in lines if l.strip())
    out = []
    for kind, body in paragraphs(lines):
        if kind == 'p':
            out.append('<p>' + ' '.join(body) + '</p>')
        else:
            out.append('<ul>')
            out.extend('  <li>' + ' '.join(item) + '</li>' for item in body)
            out.append('</ul>')
    return '\n' + ''.join(indent + l + '\n' for l in out) + indent


def main():
    blocks = load_blocks()
    html = HTML.read_text(encoding='utf-8')
    missing = []

    def replace(m):
        key = m.group('key')
        if key not in blocks:
            missing.append(key)
            return m.group(0)
        body = render(blocks[key], m.group('inline'), m.group('indent'))
        return m.group('indent') + m.group('open') + body + m.group('close')

    html = MARKER.sub(replace, html)
    HTML.write_text(html, encoding='utf-8')
    used = {m.group('key') for m in MARKER.finditer(html)}
    for key in missing:
        print('warning: no text block for marker', key, file=sys.stderr)
    for key in sorted(set(blocks) - used):
        print('warning: text block not used in index.html:', key, file=sys.stderr)


if __name__ == '__main__':
    main()
