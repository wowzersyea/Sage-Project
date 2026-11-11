"""Check a freshly written literature digest against Crossref, Europe PMC and Unpaywall.

Claude writes the digest from web search, so DOIs and open-access labels are guesses.
This pass, run before the digest is saved:

- fixes DOIs that don't resolve or belong to a different paper (or drops them),
- sets the PDF / Access lines from a real free-full-text lookup,
- re-reviews papers the digest treated as abstract-only when PubMed Central has the
  full text (capped per run),
- flags papers that were already reviewed in an earlier digest, or first published
  well before the digest's window.

Every lookup fails open: if a service is down, the article is left as Claude wrote it.
"""

from __future__ import annotations

import difflib
import os
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Callable, Optional

import requests

CONTACT = os.environ.get("DIGEST_CONTACT_EMAIL", "digest@sageproject.xyz")
HEADERS = {"User-Agent": f"sage-literature-digest/1.0 (mailto:{CONTACT})"}
FULLTEXT_MAX = int(os.environ.get("DIGEST_FULLTEXT_MAX", "6"))
FULLTEXT_CHARS = 60000

DOI_RE = re.compile(r'10\.\d{4,9}/[^\s\)\]>*,;"\']+')
SECTION_RE = re.compile(r'^(#{1,2}\s|---\s*$)')
TITLE_RE = re.compile(r'^(?:#{3,4}\s+(?P<h>.+)|\*\*(?P<b>[^*]{20,})\*\*\s*$)')
NOT_TITLE = re.compile(r'^(DOI|PDF|Access|Design|Background|Methods|Key|Discussion|Limitations|Clinical|Scope|Note|Bottom)\b', re.I)

Fetch = Callable[[str], Optional[dict]]


NOT_FOUND = {"_status": 404}


def http_json(url: str) -> Optional[dict]:
    """GET a JSON document; NOT_FOUND on 404, None after three failed tries (unknown, not absent)."""
    for attempt in range(3):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            if r.status_code == 404:
                return NOT_FOUND
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError):
            time.sleep(2 * (attempt + 1))
    return None


def http_text(url: str) -> Optional[str]:
    try:
        r = requests.get(url, headers=HEADERS, timeout=60)
        return r.text if r.ok else None
    except requests.RequestException:
        return None


def _words(t: str) -> list[str]:
    t = re.sub(r'<[^>]+>|\*', '', t or '').lower()
    t = re.sub(r'^\s*(\[?[\w /]*article \d+\]|\d+\.|[a-z]\.)\s+', '', t)
    return re.sub(r'[^a-z0-9 ]+', ' ', t).split()


def similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, ' '.join(_words(a)), ' '.join(_words(b))).ratio()


def clean_title(t: str) -> str:
    t = re.sub(r'^[^\w"“(]+', '', t).strip().strip('*').strip()
    return re.sub(r'^(\[?[\w /]*article \d+\]|\d+\.|[A-Z]\.)\s+', '', t)


@dataclass
class Paper:
    doi: Optional[str] = None          # verified DOI, lower case
    title: Optional[str] = None
    via: Optional[str] = None
    free: bool = False
    free_url: Optional[str] = None
    pmcid: Optional[str] = None
    published: Optional[str] = None    # YYYY-MM-DD from Unpaywall (first publication, often online-first)


@dataclass
class Article:
    title: str
    start: int
    end: int                           # exclusive line index
    doi_given: Optional[str] = None
    said: str = "unlabeled"            # what the digest claimed: open | paywalled | unlabeled
    paper: Paper = field(default_factory=Paper)
    doi_bad: bool = False
    repeat_of: Optional[str] = None    # digest date of the earlier review
    upgraded: bool = False


def find_articles(lines: list[str]) -> list[Article]:
    """Article blocks: a title line followed (within 4 lines) by a link, up to the next title or section."""
    starts = []
    for i, ln in enumerate(lines):
        m = TITLE_RE.match(ln.strip())
        if not m:
            continue
        title = clean_title(m.group('h') or m.group('b'))
        if len(title) < 20 or NOT_TITLE.match(title):
            continue
        if not any('http' in x or DOI_RE.search(x) for x in lines[i:i + 5]):
            continue
        starts.append((i, title))
    out = []
    for k, (i, title) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(lines)
        for j in range(i + 1, end):
            if SECTION_RE.match(lines[j]):
                end = j
                break
        block = '\n'.join(lines[i:end])
        dois = DOI_RE.findall(block)
        out.append(Article(title=title, start=i, end=end,
                           doi_given=dois[0].rstrip('.') if dois else None, said=_access_claim(block)))
    return out


def _access_claim(block: str) -> str:
    t = block.lower()
    if re.search(r'paywall|abstract[- ]only|🔒', t):
        return 'paywalled'
    if re.search(r'open access|🔓|free full text', t) or re.search(r'\*\*pdf:\*\*\s*\[?https?://', t):
        return 'open'
    return 'unlabeled'


def _is_placeholder(doi: str) -> bool:
    tail = doi.split('/', 1)[-1]
    return bool(re.search(r'x{2,}|\[|confirm', tail, re.I))


def resolve(a: Article, fetch: Fetch = http_json) -> Paper:
    """Find the real paper: the digest's DOI if it matches the title, else a title search."""
    if a.doi_given and not _is_placeholder(a.doi_given):
        resp = fetch('https://api.crossref.org/works/' + urllib.parse.quote(a.doi_given))
        if resp is None:
            return Paper()   # Crossref unreachable: leave the article as written
        cr = resp.get('message')
        if cr and similarity(a.title, (cr.get('title') or [''])[0]) >= 0.6:
            return Paper(doi=a.doi_given.lower(), title=cr['title'][0], via='digest-doi')
        a.doi_bad = True   # 404, or the DOI belongs to a different paper
    elif a.doi_given:
        a.doi_bad = True
    words = ' '.join(_words(a.title)[:14])
    if words:
        for q in (f'TITLE:"{words}"', words):
            res = ((fetch('https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&pageSize=5&query='
                          + urllib.parse.quote(q)) or {}).get('resultList') or {}).get('result') or []
            best = max(((similarity(a.title, r.get('title', '')), r) for r in res if r.get('doi')),
                       key=lambda x: x[0], default=None)
            if best and best[0] >= 0.75:
                return Paper(doi=best[1]['doi'].lower(), title=best[1]['title'], via='europepmc-title')
            if res:
                break
        cr = fetch('https://api.crossref.org/works?rows=3&query.bibliographic=' + urllib.parse.quote(a.title[:200])) or {}
        for it in (cr.get('message') or {}).get('items') or []:
            t = (it.get('title') or [''])[0]
            if similarity(a.title, t) >= 0.8:
                return Paper(doi=it['DOI'].lower(), title=t, via='crossref-title')
    return Paper()


def check_access(p: Paper, fetch: Fetch = http_json) -> Paper:
    u = fetch(f'https://api.unpaywall.org/v2/{urllib.parse.quote(p.doi)}?email={urllib.parse.quote(CONTACT)}') or {}
    best = u.get('best_oa_location') or {}
    p.published = u.get('published_date')
    e = ((fetch('https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&query='
                + urllib.parse.quote(f'DOI:"{p.doi}"')) or {}).get('resultList') or {}).get('result') or [{}]
    e = e[0] if e else {}
    p.pmcid = e.get('pmcid') if e.get('isOpenAccess') == 'Y' or e.get('inPMC') == 'Y' else None
    p.free = bool(u.get('is_oa') or p.pmcid)
    if p.pmcid:
        p.free_url = f'https://pmc.ncbi.nlm.nih.gov/articles/{p.pmcid}/'
    if best.get('url_for_pdf') or best.get('url'):
        p.free_url = best.get('url_for_pdf') or best.get('url')
    return p


def _norm_doi(d: str) -> str:
    return re.sub(r'^https?://(dx\.)?doi\.org/', '', (d or '').strip().lower()).rstrip('.')


def find_repeat(a: Article, memory: dict) -> Optional[str]:
    for old in memory.get('articles', []):
        od = _norm_doi(old.get('doi', ''))
        if a.paper.doi and od and od == a.paper.doi:
            return old.get('digest_date') or 'an earlier digest'
        if similarity(a.title, old.get('title', '')) >= 0.9:
            return old.get('digest_date') or 'an earlier digest'
    return None


def rewrite_block(block: list[str], a: Article, window_start: Optional[str] = None) -> list[str]:
    p = a.paper
    out = []
    for ln in block:
        if a.doi_given and a.doi_bad:
            if p.doi:
                ln = ln.replace(a.doi_given, p.doi)
            else:
                ln = re.sub(r'(https?://(dx\.)?doi\.org/)?' + re.escape(a.doi_given) + r'\S*', '(DOI not verified)', ln)
        if p.doi:
            ln = re.sub(r'\s*\*\((confirm|verify)[^)]*\)\*', '', ln, flags=re.I)
            if re.match(r'^\s*\*\*PDF:\*\*', ln):
                ln = re.sub(r'(\*\*PDF:\*\*).*', lambda m: f"{m.group(1)} {p.free_url if p.free and p.free_url else 'Paywalled'}", ln)
            elif re.match(r'^\s*-\s*\*\*Access:\*\*', ln):
                label = 'OPEN ACCESS' if p.free else 'PAYWALLED'
                ln = re.sub(r'(\*\*Access:\*\*).*', rf'\1 {label} (checked: Unpaywall/Europe PMC)', ln)
        out.append(ln)
    if p.doi and out:
        out[0] = out[0].replace('🔓', '🔒') if not p.free else out[0].replace('🔒', '🔓')
    notes = []
    if p.doi and a.said == 'open' and not p.free:
        notes.append('> ⚠️ Access check: no free full text was found for this paper, so this review may rest on the abstract or secondary sources.')
    if p.doi and a.said != 'open' and p.free and not a.upgraded:
        notes.append(f'> 🔓 Free full text is available: {p.free_url or p.doi}. This review was written from the abstract.')
    if a.repeat_of:
        notes.append(f'> ↩️ Previously reviewed in the {a.repeat_of} digest.')
    if is_old(p.published, window_start):
        notes.append(f'> 🗓️ First published {p.published}, before this digest\'s window (it may have just appeared in a print issue).')
    if notes:
        while out and not out[-1].strip():
            out.pop()
        out += [''] + notes + ['']
    return out


def is_old(published: Optional[str], window_start: Optional[str], grace_days: int = 7) -> bool:
    if not (published and window_start):
        return False
    try:
        from datetime import date, timedelta
        return date.fromisoformat(published[:10]) < date.fromisoformat(window_start[:10]) - timedelta(days=grace_days)
    except ValueError:
        return False


def pmc_fulltext(pmcid: str, get_text: Callable[[str], Optional[str]] = http_text) -> Optional[str]:
    xml = get_text(f'https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML')
    if not xml or '<body' not in xml:
        return None
    body = xml[xml.find('<body'):]
    body = re.sub(r'<(table-wrap|fig|ref-list)[\s\S]*?</\1>', ' ', body)
    text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', body)).strip()
    return text[:FULLTEXT_CHARS] if len(text) > 2000 else None


UPGRADE_PROMPT = """Below is one article review from a literature digest for pediatric infectious disease specialists, followed by the paper's FULL TEXT from PubMed Central. The review was written from the abstract only.

Rewrite the review from the full text, as a journal-club level review:
- Keep the exact same format, title line, journal/date line, links and field labels.
- Set Access to OPEN ACCESS and remove any "[PAYWALL: Abstract only reviewed]" marker.
- Report actual numbers from the paper: sample size, effect sizes with 95% CIs and p-values, absolute numbers.
- Use only facts from the full text. If something is not in it, leave it out.
- Return only the rewritten review, no preamble.

REVIEW:
{review}

FULL TEXT ({pmcid}):
{fulltext}"""


def upgrade_review(block: list[str], a: Article, fulltext: str, client, model: str) -> Optional[list[str]]:
    msg = client.messages.create(
        model=model, max_tokens=4000,
        messages=[{"role": "user", "content": UPGRADE_PROMPT.format(review='\n'.join(block), pmcid=a.paper.pmcid, fulltext=fulltext)}])
    text = ''.join(b.text for b in msg.content if b.type == 'text').strip()
    if not text or len(text) < 200 or a.title[:30].lower() not in text.lower():
        return None   # the model lost the title line or returned little: keep the original
    return text.splitlines() + ['']


def verify_digest(content: str, memory: dict, fetch: Fetch = http_json, client=None,
                  model: str = "claude-sonnet-4-6", get_text: Callable[[str], Optional[str]] = http_text,
                  fulltext_max: int = FULLTEXT_MAX, window_start: Optional[str] = None,
                  log=print) -> tuple[str, dict]:
    """Return (corrected digest, report)."""
    lines = content.splitlines()
    arts = find_articles(lines)
    upgrades = 0
    for a in arts:
        try:
            a.paper = resolve(a, fetch)
            if a.doi_bad and a.paper.doi and a.paper.doi == a.doi_given.lower():
                a.doi_bad = False   # paraphrased title, but the title search confirmed the same DOI
            if a.paper.doi:
                check_access(a.paper, fetch)
            a.repeat_of = find_repeat(a, memory)
        except Exception as e:   # one bad article never sinks the digest
            log(f"  verify: {a.title[:60]}: {e}")
    for a in reversed(arts):   # bottom-up so line indexes stay valid
        block = lines[a.start:a.end]
        if (client and upgrades < fulltext_max and a.paper.pmcid and a.said != 'open' and not a.repeat_of):
            try:
                ft = pmc_fulltext(a.paper.pmcid, get_text)
                new = upgrade_review(block, a, ft, client, model) if ft else None
                if new:
                    block, a.upgraded = new, True
                    upgrades += 1
            except Exception as e:
                log(f"  full-text review failed for {a.paper.pmcid}: {e}")
        lines[a.start:a.end] = rewrite_block(block, a, window_start)
    report = {
        "articles": len(arts),
        "verified": sum(1 for a in arts if a.paper.doi),
        "free_full_text": sum(1 for a in arts if a.paper.free),
        "dois_fixed": sum(1 for a in arts if a.doi_bad and a.paper.doi),
        "dois_removed": sum(1 for a in arts if a.doi_bad and not a.paper.doi),
        "said_open_but_paywalled": sum(1 for a in arts if a.paper.doi and a.said == 'open' and not a.paper.free),
        "said_paywalled_but_free": sum(1 for a in arts if a.paper.doi and a.said != 'open' and a.paper.free),
        "reviewed_from_full_text": upgrades,
        "repeats": sum(1 for a in arts if a.repeat_of),
        "published_before_window": sum(1 for a in arts if is_old(a.paper.published, window_start)),
        "items": [{"title": a.title[:200], "doi": a.paper.doi, "free": a.paper.free, "pmcid": a.paper.pmcid,
                   "digest_said": a.said, "doi_given": a.doi_given, "doi_bad": a.doi_bad,
                   "repeat_of": a.repeat_of, "upgraded": a.upgraded, "published": a.paper.published} for a in arts],
    }
    return '\n'.join(lines) + ('\n' if content.endswith('\n') else ''), report
