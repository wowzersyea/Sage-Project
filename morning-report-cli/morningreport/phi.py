"""Identifier patterns, mirroring morning-report/assets/phi.js.

The browser half runs this check before writing to the case bank. The
CLI runs it in two places: over the transcript when scoring A1, and over
anything it drafts, so a model-written sentence cannot reintroduce an
identifier the transcript happened to contain.

Kept deliberately close to the JavaScript so the two halves agree; a
test compares the two rule sets.
"""

from __future__ import annotations

import re

EPONYMS = set("""
kawasaki kocher epstein barr crohn cushing down turner marfan ehlers danlos guillain barre
wilms wilson reye kussmaul kernig brudzinski murphy mcburney rovsing hirschsprung meckel bell
duchenne becker prader willi angelman rett digeorge noonan alagille gilbert dubin crigler
najjar budd chiari lyme zika nikolsky coombs kayser fleischer osler roth janeway austin flint
still sydenham jones duke glasgow apgar tanner ortolani barlow galeazzi salter harris legg
calve perthes osgood schlatter sever kohler blount erb klumpke horner todd landau kleffner
west lennox gastaut dravet doose ohtahara aicardi sturge weber hippel lindau peutz jeghers
gardner lynch fraumeni beckwith wiedemann russell silver mccune albright klinefelter kallmann
addison conn graves hashimoto riedel quervain paget pott charcot marie tooth friedreich
wernicke korsakoff parkinson alzheimer huntington tay sachs niemann pick gaucher fabry hurler
hunter sanfilippo morquio pompe mcardle gierke cori andersen hers menkes zellweger refsum
krabbe canavan alexander leigh kearns sayre pearson barth bartter gitelman liddle fanconi
alport berger goodpasture wegener churg strauss takayasu behcet sjogren raynaud reiter felty
caplan loeffler ghon ranke pancoast virchow cullen homan trousseau chvostek hoover phalen
tinel finkelstein thomas trendelenburg gower romberg babinski moro gallant hering breuer
frank starling laplace poiseuille bernoulli monro kellie cheyne stokes biot mallory weiss
boerhaave zenker barrett whipple cantrell poland klippel feil sprengel arnold dandy walker
joubert miller dieker smith lemli opitz cornelia lange rubinstein taybi williams beuren
shprintzen waardenburg usher pendred jervell nielsen romano ward brugada wolff white
eisenmenger fallot ebstein blalock taussig fontan glenn norwood rashkind ross konno bland
garland stephens takotsubo hamman rich wells geneva centor mcisaac rochester philadelphia
boston pecarn napqi finnegan ballard dubowitz silverman downes westley bosworth monteggia
colles bennett rolando jefferson hangman chance lisfranc chopart maisonneuve tillaux
wagstaffe segond gram ziehl neelsen giemsa wright papanicolaou romanowsky grunwald prussian
escherich koch pasteur lister semmelweis jenner salk sabin mantoux heaf tine
""".split())

CLINICAL_NOUNS = re.compile(
    r"^(disease|syndrome|criteria|criterion|sign|signs|test|tests|classification|score|scoring|"
    r"index|maneuver|manoeuvre|reflex|triad|tetrad|pentad|phenomenon|body|bodies|cell|cells|"
    r"stain|staining|virus|bacillus|ratio|law|rule|rules|murmur|node|nodes|spot|spots|line|lines|"
    r"fracture|deformity|arch|duct|canal|plexus|ganglion|tumor|tumour|lymphoma|sarcoma|anemia|"
    r"anaemia|shunt|procedure|operation|repair|approach|position|grip|type|stage|grade|scale|"
    r"curve|chart|formula|equation|method|technique|view|projection|angle|point|space|pouch|"
    r"gland|fissure|foramen|ligament|tendon|muscle|nerve|artery|vein|agar|broth|medium|toxin|"
    r"antigen|antibody|factor|deficiency|dystrophy|atrophy|ataxia|palsy|encephalopathy|"
    r"nephropathy|neuropathy|myopathy|cardiomyopathy|granulomatosis|arteritis|vasculitis)\b",
    re.IGNORECASE,
)

NOT_A_FIRST_NAME = set("""
january february march april may june july august september october november december
monday tuesday wednesday thursday friday saturday sunday admitted presented discharged
transferred seen started stopped given the this that his her their our patient mother father
family history exam labs imaging blood urine chest abdominal neurologic initial repeat final
working differential problem
""".split())

RULES = [
    ("MRN", "block",
     re.compile(r"\b(?:mrn|m\.r\.n\.|medical\s+record(?:\s+(?:number|no\.?|#))?|record\s+(?:number|no\.?|#)|acct\.?|account\s+(?:number|no\.?|#)|chart\s+(?:number|no\.?|#))\s*[:#]?\s*[A-Za-z]?\d{3,}", re.I),
     "A medical record number."),
    ("long number", "block",
     re.compile(r"(?:^|[^\w.\-/])(\d{7,12})(?![\d\-./])"),
     "A seven-to-twelve digit run reads as a record or account number."),
    ("phone number", "block",
     re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b"),
     "A phone number."),
    ("SSN", "block",
     re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
     "A social security number."),
    ("date of service", "block",
     re.compile(r"\b(?:\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})\b"),
     "A date of service."),
    ("date of service", "block",
     re.compile(r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*(?:19|20)\d{2}\b", re.I),
     "A date of service."),
    ("age over 89", "block",
     re.compile(r"\b(9\d|1\d\d)[\s-]*(?:year|yr|y)[\s-]*(?:old|o)\b", re.I),
     "An age over 89 is an identifier in its own right."),
    ("address", "block",
     re.compile(r"\b\d{1,5}\s+[A-Z][a-z]+\s+(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|boulevard|blvd\.?)\b", re.I),
     "A street address."),
    ("named person", "block",
     re.compile(r"\b(?:[Mm]r|[Mm]rs|[Mm]s|[Mm]iss|[Dd]r|[Dd]octor)\.?\s+([A-Z][a-z]{2,})\b"),
     "A name behind an honorific."),
    ("named relative", "block",
     re.compile(r"\b(?:[Mm]other|[Ff]ather|[Mm]om|[Dd]ad|[Pp]arent|[Gg]uardian|[Ss]ister|[Bb]rother|[Gg]randmother|[Gg]randfather)\s+(?:named\s+)?([A-Z][a-z]{2,})\b"),
     "A family member's name."),
]

NAME_PAIR = re.compile(r"\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b")


def _looks_clinical(text: str, index: int, first: str, second: str) -> bool:
    if first.lower() in EPONYMS or second.lower() in EPONYMS:
        return True
    after = text[index + len(first) + 1 + len(second):].lstrip(" ,.;:)-")
    return bool(CLINICAL_NOUNS.match(after) or CLINICAL_NOUNS.match(second))


def scan(text: str, field: str = "") -> list[dict]:
    """Return [{field, kind, severity, match, why, index}]."""
    if not text:
        return []
    found: list[dict] = []

    for kind, severity, pattern, why in RULES:
        for m in pattern.finditer(text):
            hit = m.group(0).strip()
            if kind == "named person":
                surname = m.group(1).lower() if m.lastindex else ""
                if surname in EPONYMS:
                    continue
            found.append({
                "field": field, "kind": kind, "severity": severity,
                "match": hit, "why": why, "index": m.start(),
            })

    for m in NAME_PAIR.finditer(text):
        first, second = m.group(1), m.group(2)
        if _looks_clinical(text, m.start(), first, second):
            continue
        if first.lower() in NOT_A_FIRST_NAME:
            continue
        start, end = m.start(), m.end()
        if any(start < f["index"] + len(f["match"]) and f["index"] < end for f in found):
            continue
        found.append({
            "field": field, "kind": "possible name", "severity": "check",
            "match": m.group(0),
            "why": "This has the shape of a person's name.",
            "index": start,
        })

    return sorted(found, key=lambda f: f["index"])


def blocking(findings: list[dict]) -> list[dict]:
    return [f for f in findings if f["severity"] == "block"]
