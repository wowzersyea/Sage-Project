/* ==================================================================
   MRPhi — the identifier check that runs before anything is written
   to the case bank.

   Two severities, because two different things are being detected:

     block  — patterns that are identifiers almost every time they
              match: a medical record number, a date of service, a
              phone number, an age over 89, a name behind an
              honorific. These stop the save outright.

     check  — a capitalised pair that has the shape of a person's
              name. This cannot be decided by pattern: "Kawasaki
              disease" and "Kawasaki, James" look the same to a
              regular expression. Known eponyms and anything followed
              by a clinical noun are filtered out first; whatever
              survives is put to the user, one at a time, and the
              save stays blocked until each is either edited away or
              confirmed as clinical.

   Nothing here is a substitute for reading the text. It is the floor,
   not the ceiling.
   ================================================================== */

(function (global) {
  "use strict";

  /* Eponyms common enough in pediatrics that flagging them would
     train the user to click through the warning without reading it,
     which is worse than not warning at all. */
  var EPONYMS = ("kawasaki kocher epstein barr crohn cushing down turner marfan ehlers danlos " +
    "guillain barre henoch schonlein schönlein wilms wilson reye kussmaul kernig brudzinski " +
    "murphy mcburney rovsing hirschsprung meckel bell duchenne becker prader willi angelman " +
    "rett digeorge noonan alagille gilbert dubin crigler najjar budd chiari lyme zika nikolsky " +
    "coombs kayser fleischer osler roth janeway austin flint still sydenham jones duke glasgow " +
    "apgar tanner ortolani barlow galeazzi salter harris legg calve perthes osgood schlatter " +
    "sever kohler blount erb klumpke horner todd landau kleffner west lennox gastaut dravet " +
    "doose ohtahara aicardi sturge weber hippel lindau peutz jeghers gardner lynch fraumeni " +
    "beckwith wiedemann russell silver mccune albright klinefelter kallmann addison conn graves " +
    "hashimoto riedel quervain paget pott charcot marie tooth friedreich wernicke korsakoff " +
    "parkinson alzheimer huntington tay sachs niemann pick gaucher fabry hurler hunter " +
    "sanfilippo morquio pompe mcardle gierke cori andersen hers menkes zellweger refsum krabbe " +
    "canavan alexander leigh kearns sayre pearson barth bartter gitelman liddle fanconi alport " +
    "berger goodpasture wegener churg strauss takayasu behcet behçet sjogren sjögren raynaud " +
    "reiter felty caplan loeffler ghon ranke pancoast virchow cullen grey turner homan " +
    "trousseau chvostek hoover phalen tinel finkelstein thomas trendelenburg gower romberg " +
    "babinski moro gallant hering breuer frank starling laplace poiseuille bernoulli monro " +
    "kellie cheyne stokes biot kussmal mallory weiss boerhaave zenker barrett whipple " +
    "cantrell poland klippel feil sprengel arnold dandy walker joubert miller dieker " +
    "smith lemli opitz cornelia lange rubinstein taybi williams beuren digeorge shprintzen " +
    "waardenburg usher pendred jervell nielsen romano ward brugada wolff white long qt " +
    "eisenmenger fallot ebstein blalock taussig fontan glenn norwood rashkind ross konno " +
    "bland garland stephens takotsubo hamman rich goodpasture wells geneva centor mcisaac " +
    "rochester philadelphia boston pecarn napqi finnegan ballard dubowitz silverman downes " +
    "westley bosworth monteggia galeazzi colles smith bennett rolando jefferson hangman " +
    "chance jones lisfranc chopart maisonneuve tillaux wagstaffe segond " +
    "gram ziehl neelsen giemsa wright papanicolaou romanowsky may grunwald prussian " +
    "escherich koch pasteur lister semmelweis jenner salk sabin bcg mantoux heaf tine")
    .split(/\s+/).reduce(function (m, w) { m[w] = 1; return m; }, {});

  /* If a capitalised pair is followed by one of these, it is a thing,
     not a person. */
  var CLINICAL_NOUNS = new RegExp(
    "^(disease|syndrome|criteria|criterion|sign|signs|test|tests|classification|score|scoring|" +
    "index|maneuver|manoeuvre|reflex|triad|tetrad|pentad|phenomenon|body|bodies|cell|cells|" +
    "stain|staining|virus|bacillus|ratio|law|rule|rules|murmur|node|nodes|spot|spots|line|lines|" +
    "fracture|deformity|arch|duct|canal|plexus|ganglion|tumor|tumour|lymphoma|sarcoma|anemia|" +
    "anaemia|shunt|procedure|operation|repair|approach|position|grip|type|stage|grade|scale|" +
    "curve|chart|formula|equation|method|technique|view|projection|angle|point|space|pouch|" +
    "gland|fissure|foramen|ligament|tendon|muscle|nerve|artery|vein|agar|broth|medium|toxin|" +
    "antigen|antibody|factor|deficiency|dystrophy|atrophy|ataxia|palsy|encephalopathy|" +
    "nephropathy|neuropathy|myopathy|cardiomyopathy|granulomatosis|arteritis|vasculitis)\\b", "i");

  var RULES = [
    { kind: "MRN",
      severity: "block",
      re: /\b(?:mrn|m\.r\.n\.|medical\s+record(?:\s+(?:number|no\.?|#))?|record\s+(?:number|no\.?|#)|acct\.?|account\s+(?:number|no\.?|#)|chart\s+(?:number|no\.?|#))\s*[:#]?\s*[A-Za-z]?\d{3,}/gi,
      why: "A medical record number. Case bank entries are permanent — strip it." },

    { kind: "long number",
      severity: "block",
      re: /(?:^|[^\w.\-\/])(\d{7,12})(?![\d\-.\/])/g,
      why: "A seven-to-twelve digit run reads as a record or account number. If it is a lab value, add its units.",
      allow: function (m) { return false; } },

    { kind: "phone number",
      severity: "block",
      re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
      why: "A phone number." },

    { kind: "SSN",
      severity: "block",
      re: /\b\d{3}-\d{2}-\d{4}\b/g,
      why: "A social security number." },

    { kind: "date of service",
      severity: "block",
      re: /\b(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/g,
      why: "A date of service. Say “day 3 of illness” or “two weeks ago” instead." },

    { kind: "date of service",
      severity: "block",
      re: /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*(?:19|20)\d{2}\b/gi,
      why: "A date of service. Say “day 3 of illness” or “two weeks ago” instead." },

    { kind: "age over 89",
      severity: "block",
      re: /\b(9\d|1\d\d)[\s-]*(?:year|yr|y)[\s-]*(?:old|o)\b/gi,
      why: "An age over 89 is an identifier in its own right. Use “over 89”." },

    { kind: "address",
      severity: "block",
      re: /\b\d{1,5}\s+[A-Z][a-z]+\s+(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|boulevard|blvd\.?)\b/gi,
      why: "A street address." },

    { kind: "named person",
      severity: "block",
      re: /\b(?:[Mm]r|[Mm]rs|[Mm]s|[Mm]iss|[Dd]r|[Dd]octor)\.?\s+[A-Z][a-z]{2,}\b/g,
      why: "A name behind an honorific.",
      allowMatch: function (m) {
        var last = m.split(/\s+/).pop().toLowerCase();
        return !!EPONYMS[last];
      } },

    { kind: "named relative",
      severity: "block",
      re: /\b(?:[Mm]other|[Ff]ather|[Mm]om|[Dd]ad|[Pp]arent|[Gg]uardian|[Ss]ister|[Bb]rother|[Gg]randmother|[Gg]randfather)\s+(?:named\s+)?[A-Z][a-z]{2,}\b/g,
      why: "A family member's name." }
  ];

  var NAME_PAIR = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g;

  /* Words that open a sentence or name a date. A capitalised pair
     starting with one of these is a sentence, not a person. */
  var NOT_A_FIRST_NAME = ("january february march april may june july august september october " +
    "november december monday tuesday wednesday thursday friday saturday sunday " +
    "admitted presented discharged transferred seen started stopped given the this that " +
    "his her their our patient mother father family history exam labs imaging blood urine " +
    "chest abdominal neurologic initial repeat final working differential problem")
    .split(/\s+/).reduce(function (m, w) { m[w] = 1; return m; }, {});

  function nameLooksClinical(text, index, first, second) {
    if (EPONYMS[first.toLowerCase()] || EPONYMS[second.toLowerCase()]) return true;
    var after = text.slice(index + first.length + 1 + second.length).replace(/^[\s,.;:)\-]+/, "");
    if (CLINICAL_NOUNS.test(after)) return true;
    if (CLINICAL_NOUNS.test(second)) return true;
    return false;
  }

  /* Returns [{ field, kind, severity, match, why, index }] */
  function scan(text, field) {
    var found = [];
    if (!text) return found;

    RULES.forEach(function (rule) {
      rule.re.lastIndex = 0;
      var m;
      while ((m = rule.re.exec(text)) !== null) {
        var hit = m[0].trim();
        if (rule.allowMatch && rule.allowMatch(hit)) continue;
        found.push({
          field: field, kind: rule.kind, severity: rule.severity,
          match: hit, why: rule.why, index: m.index
        });
        if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
      }
    });

    NAME_PAIR.lastIndex = 0;
    var n;
    while ((n = NAME_PAIR.exec(text)) !== null) {
      if (nameLooksClinical(text, n.index, n[1], n[2])) continue;
      if (NOT_A_FIRST_NAME[n[1].toLowerCase()]) continue;
      // already caught, and more precisely, by one of the rules above
      var start = n.index, end = n.index + n[0].length;
      if (found.some(function (f) {
        return start < f.index + f.match.length && f.index < end;
      })) continue;
      found.push({
        field: field, kind: "possible name", severity: "check",
        match: n[0], why: "This has the shape of a person's name. If it is clinical, say so and it will be left alone.",
        index: n.index
      });
    }

    return found;
  }

  /* Scan an object of { fieldLabel: text }. */
  function scanAll(fields) {
    var out = [];
    Object.keys(fields).forEach(function (label) {
      var v = fields[label];
      if (Array.isArray(v)) v = v.join("\n");
      out = out.concat(scan(String(v == null ? "" : v), label));
    });
    return out;
  }

  function blocking(findings) {
    return findings.filter(function (f) { return f.severity === "block"; });
  }

  global.MRPhi = {
    scan: scan,
    scanAll: scanAll,
    blocking: blocking,
    EPONYMS: EPONYMS
  };
})(window);
