"""Offline tests for scripts/digest_verify.py (no network: Crossref, Europe PMC and Unpaywall are faked).

Run: python -m pytest tests/test_digest_verify.py -q
"""
import sys
import urllib.parse
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import digest_verify as dv  # noqa: E402

DIGEST = """# 📚 Literature Digest: October 18 – November 01, 2026

## 🦠 Pediatric ID Studies

### 🔓 First Do No Harm: When Can and Should We Withhold Antibiotics in Neonates?
*The Pediatric Infectious Disease Journal*, October 19, 2026
**DOI:** https://doi.org/10.1097/INF.0000000000005446
**PDF:** https://journals.lww.com/pidj *(confirm open-access PDF at publisher)*
- **Access:** OPEN ACCESS (confirmed via AMEDEO citation)
- **Design:** Commentary.

### Current Prognostic Models Fail to Reliably Distinguish Kawasaki Disease From Mimics
*PIDJ*, October 2026
**DOI:** https://doi.org/10.1097/INF.0000000000005XXX
**PDF:** Paywalled
- **Access:** PAYWALLED
- **Key Findings:** Abstract says models underperform.
[PAYWALL: Abstract only reviewed]

### Empirical Antibiotic Activity and Outcomes in Pediatric Gram-Negative Bloodstream Infection
*JPIDS*, October 2026 | https://academic.oup.com/jpids
**PDF:** Paywalled
- **Access:** PAYWALLED

---
## 📋 Guideline Updates
No new guidelines.
"""

KAWASAKI = "Current Prognostic Models Fail to Reliably Distinguish Kawasaki Disease From Mimics"
GNBSI = "Empirical Antibiotic Activity and Outcomes in Pediatric Gram-Negative Bloodstream Infection"
NEO = "First Do No Harm: When Can and Should We Withhold Antibiotics in Neonates?"


def fake_fetch(url):
    u = urllib.parse.unquote(url)
    if "api.crossref.org/works/10.1097/INF.0000000000005446" in u:
        return {"message": {"title": [NEO]}}
    if "europepmc" in u and 'DOI:"' in u:
        if "10.1097/inf.0000000000005450" in u:
            return {"resultList": {"result": [{"pmcid": "PMC13649263", "isOpenAccess": "Y"}]}}
        return {"resultList": {"result": [{"isOpenAccess": "N"}]}}
    if "europepmc" in u and "kawasaki" in u.lower():
        return {"resultList": {"result": [{"title": KAWASAKI + ".", "doi": "10.1097/INF.0000000000005450"}]}}
    if "europepmc" in u and "gram negative" in u.lower():
        return {"resultList": {"result": [{"title": GNBSI, "doi": "10.1093/jpids/piag090"}]}}
    if "unpaywall" in u:
        if "10.1093/jpids/piag090" in u:
            return {"is_oa": True, "best_oa_location": {"url": "https://academic.oup.com/jpids/oa"}}
        if "10.1097/inf.0000000000005450" in u:
            return {"is_oa": True, "best_oa_location": {"url_for_pdf": None, "url": None}}
        return {"is_oa": False}
    return None


def test_finds_three_articles_and_stops_at_sections():
    arts = dv.find_articles(DIGEST.splitlines())
    assert [a.title[:20] for a in arts] == [NEO[:20], KAWASAKI[:20], GNBSI[:20]]
    assert "Guideline" not in "\n".join(DIGEST.splitlines()[arts[-1].start:arts[-1].end])
    assert [a.said for a in arts] == ["open", "paywalled", "paywalled"]


def test_corrects_labels_dois_and_flags():
    out, rep = dv.verify_digest(DIGEST, {"articles": []}, fetch=fake_fetch, log=lambda *_: None)
    # open-access claim was wrong
    assert "### 🔒 First Do No Harm" in out
    assert "**PDF:** Paywalled" in out.split(KAWASAKI)[0]
    assert "Access check: no free full text" in out
    assert "confirm open-access PDF" not in out
    # placeholder DOI replaced by the real one; free copy announced
    assert "5XXX" not in out and "10.1097/inf.0000000000005450" in out
    assert "**PDF:** https://pmc.ncbi.nlm.nih.gov/articles/PMC13649263/" in out
    # no DOI given, found by title, free at the publisher
    assert "**PDF:** https://academic.oup.com/jpids/oa" in out
    assert out.count("Free full text is available") == 2
    assert rep["said_open_but_paywalled"] == 1 and rep["said_paywalled_but_free"] == 2
    assert rep["dois_fixed"] == 1 and rep["dois_removed"] == 0 and rep["verified"] == 3
    assert out.rstrip().endswith("No new guidelines.")


def test_unresolvable_placeholder_doi_is_removed():
    out, rep = dv.verify_digest(DIGEST, {}, fetch=lambda u: None, log=lambda *_: None)
    assert "5XXX" not in out and "(DOI not verified)" in out
    assert rep["dois_removed"] == 1 and rep["verified"] == 0
    # nothing verified -> labels untouched
    assert "OPEN ACCESS (confirmed via AMEDEO citation)" in out


def test_repeat_flagged_by_doi_or_title():
    memory = {"articles": [{"title": GNBSI, "doi": "", "digest_date": "2026-09-06"},
                           {"title": "x", "doi": "https://doi.org/10.1097/INF.0000000000005446", "digest_date": "2026-10-18"}]}
    out, rep = dv.verify_digest(DIGEST, memory, fetch=fake_fetch, log=lambda *_: None)
    assert "Previously reviewed in the 2026-09-06 digest" in out
    assert "Previously reviewed in the 2026-10-18 digest" in out
    assert rep["repeats"] == 2


class FakeClient:
    def __init__(self, text):
        self.text, self.calls = text, 0
        self.messages = self

    def create(self, **kw):
        self.calls += 1
        assert "FULL TEXT (PMC13649263)" in kw["messages"][0]["content"]
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=self.text)])


def test_full_text_rereview_replaces_abstract_review():
    new = (f"### {KAWASAKI}\n*PIDJ*, October 2026\n**DOI:** https://doi.org/10.1097/INF.0000000000005450\n"
           "**PDF:** x\n- **Access:** OPEN ACCESS\n- **Key Findings:** AUC 0.61 (95% CI 0.55-0.67) across 412 children. "
           + "Detail. " * 30)
    client = FakeClient(new)
    xml = "<article><body>" + "<p>Results text.</p>" * 400 + "</body></article>"
    out, rep = dv.verify_digest(DIGEST, {}, fetch=fake_fetch, client=client, get_text=lambda u: xml, log=lambda *_: None)
    assert client.calls == 1 and rep["reviewed_from_full_text"] == 1
    assert "AUC 0.61" in out and "[PAYWALL: Abstract only reviewed]" not in out.split(GNBSI)[0]
    assert out.count("Free full text is available") == 1     # only the non-PMC one keeps the note


def test_full_text_rereview_rejected_when_title_lost():
    client = FakeClient("Sorry, I cannot do that." * 20)
    xml = "<article><body>" + "<p>Results text.</p>" * 400 + "</body></article>"
    out, rep = dv.verify_digest(DIGEST, {}, fetch=fake_fetch, client=client, get_text=lambda u: xml, log=lambda *_: None)
    assert rep["reviewed_from_full_text"] == 0 and "Abstract says models underperform." in out


def test_fetch_exception_leaves_article_unchanged():
    def boom(url):
        raise RuntimeError("network down")
    out, rep = dv.verify_digest(DIGEST, {}, fetch=boom, log=lambda *_: None)
    assert "OPEN ACCESS (confirmed via AMEDEO citation)" in out and rep["verified"] == 0


def test_old_publication_flagged_and_same_doi_not_counted_as_fix():
    def fetch(url):
        u = urllib.parse.unquote(url)
        if "unpaywall" in u and "10.1097/inf.0000000000005450" in u:
            return {"is_oa": False, "published_date": "2026-05-20"}
        if "api.crossref.org/works/10.1097/INF.0000000000005446" in u:
            return {"message": {"title": ["Something paraphrased differently entirely"]}}
        if "europepmc" in u and "withhold" in u.lower():
            return {"resultList": {"result": [{"title": NEO, "doi": "10.1097/INF.0000000000005446"}]}}
        return fake_fetch(url)
    out, rep = dv.verify_digest(DIGEST, {}, fetch=fetch, window_start="2026-10-18", log=lambda *_: None)
    assert "First published 2026-05-20, before this digest's window" in out
    assert rep["published_before_window"] == 1
    assert rep["dois_fixed"] == 1          # only the 5XXX placeholder; 5446 was confirmed, not fixed
