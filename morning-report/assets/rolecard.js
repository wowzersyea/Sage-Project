/* ==================================================================
   MRCard — renders one role card from content/roles.json.

   The page and its print view come from the same call, so the web
   card and the handout cannot drift. Change the senior's block from
   five minutes to four in roles.json and it moves here, in the print
   view, in the run-of-show table and on the draw page.
   ================================================================== */

(function (global) {
  "use strict";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function section(title, anchor) {
    var s = el("section", "card-sec");
    if (anchor) s.id = anchor;
    if (title) s.appendChild(el("h2", null, title));
    return s;
  }

  function bullets(items) {
    var ul = el("ul");
    (items || []).forEach(function (i) { ul.appendChild(el("li", null, i)); });
    return ul;
  }

  /* ---------- the 25-minute strip ------------------------------------ */

  function strip(role, blockId) {
    var segs = MRContent.strip(blockId);
    var total = MRContent.get().format.minutes;

    var wrap = el("div", "strip-wrap");
    wrap.appendChild(el("div", "strip-lbl", "Your block in the 25 minutes"));

    var bar = el("div", "strip");
    segs.forEach(function (s) {
      var seg = el("div", "seg", s.label);
      seg.style.flex = (s.end - s.start) + " 0 0";
      if (role.strip_key === "all") seg.classList.add("all");
      else if (role.strip_key === s.key) seg.classList.add("mine");
      seg.title = MRContent.fmt(s.start) + " – " + MRContent.fmt(s.end);
      bar.appendChild(seg);
    });
    wrap.appendChild(bar);

    var ends = el("div", "strip-ends");
    ends.appendChild(el("span", null, "0:00"));
    ends.appendChild(el("span", null, MRContent.fmt(total)));
    wrap.appendChild(ends);
    return wrap;
  }

  /* ---------- section kinds -------------------------------------------- */

  function renderSection(sec, blockId) {
    if (sec.kind === "script") {
      var box = el("div", "script" + (sec.variant === "bad" ? " bad" : ""));
      if (sec.anchor) box.id = sec.anchor;
      box.appendChild(el("h3", null, sec.title));
      box.appendChild(el("p", null, sec.body));
      var w = el("section", "card-sec");
      w.appendChild(box);
      return w;
    }

    if (sec.kind === "numbered") {
      var s = section(sec.title, sec.anchor);
      var ol = el("ol", "deliverables");
      (sec.items || []).forEach(function (i) { ol.appendChild(el("li", null, i)); });
      s.appendChild(ol);
      return s;
    }

    if (sec.kind === "moves") {
      var sm = section(sec.title, sec.anchor);
      var ul = el("ul", "moves");
      (sec.items || []).forEach(function (m, i) {
        var li = el("li");
        li.id = "moves-" + i;
        li.appendChild(el("div", "mv", m.move));
        li.appendChild(el("div", "sc", m.script));
        ul.appendChild(li);
      });
      sm.appendChild(ul);
      return sm;
    }

    if (sec.kind === "table") {
      var st = section(sec.title, sec.anchor);
      var tbl = el("table", "card-tbl");
      var tb = el("tbody");
      (sec.rows || []).forEach(function (r) {
        var tr = el("tr");
        tr.appendChild(el("td", null, r[0]));
        tr.appendChild(el("td", null, r[1]));
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      st.appendChild(tbl);
      return st;
    }

    if (sec.kind === "zones") {
      var sz = section(sec.title, sec.anchor);
      sz.appendChild(el("div", "zone-header", sec.header));
      var pr = el("div", "zone-pr");
      pr.appendChild(el("div", "lb", sec.pr));
      pr.appendChild(el("div", "ln", sec.pr_line));
      sz.appendChild(pr);
      var grid = el("div", "zones");
      (sec.columns || []).forEach(function (c) {
        var z = el("div", "zone");
        z.appendChild(el("h4", null, c.title));
        z.appendChild(el("div", "col", c.colour));
        z.appendChild(bullets(c.lines));
        grid.appendChild(z);
      });
      sz.appendChild(grid);
      return sz;
    }

    if (sec.kind === "ladder") {
      var sl = section(sec.title, sec.anchor);
      sl.appendChild(ladderTable(blockId, false));
      var d = MRContent.get();
      if (d.escalation_note) {
        var n = el("div", "note-box");
        n.style.marginTop = "10px";
        n.appendChild(el("p", null, d.escalation_note));
        sl.appendChild(n);
      }
      return sl;
    }

    // "note" and anything unrecognised
    var sn = el("section", "card-sec");
    if (sec.anchor) sn.id = sec.anchor;
    var nb = el("div", "note-box");
    if (sec.title) nb.appendChild(el("h3", null, sec.title));
    nb.appendChild(el("p", null, sec.body));
    sn.appendChild(nb);
    return sn;
  }

  function ladderTable(blockId, markNow) {
    var tbl = el("table", "ladder");
    var head = el("thead");
    var hr = el("tr");
    ["Block", "The intern also owes", "Senior block"].forEach(function (h) {
      hr.appendChild(el("th", null, h));
    });
    head.appendChild(hr);
    tbl.appendChild(head);
    var tb = el("tbody");
    MRContent.blocks().forEach(function (b) {
      var tr = el("tr");
      if (markNow && b.id === blockId) tr.className = "now";
      tr.appendChild(el("td", null, b.label));
      tr.appendChild(el("td", null, b.summary));
      tr.appendChild(el("td", null, b.senior_minutes + " min"));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    return tbl;
  }

  /* ---------- the PGY-1 card's block panel ------------------------------ */

  function blockPanel(blockId) {
    var b = MRContent.block(blockId);
    var wrap = el("div");

    var now = el("div", "block-now");
    now.appendChild(el("div", "lb", "This block · " + b.label));
    now.appendChild(el("p", "ask", b.ask
      ? "On top of the four deliverables, you also owe " + b.ask + "."
      : "The four deliverables only. Nothing extra has been introduced yet."));
    now.appendChild(el("p", "sub",
      "Your first pass runs " + MRContent.pgy1Minutes(blockId) + " minutes this block. " +
      "You are not held to anything below until its block arrives."));
    wrap.appendChild(now);

    var det = el("details", "ladder");
    det.appendChild(el("summary", null, "The rest of the year"));
    det.appendChild(ladderTable(blockId, true));
    wrap.appendChild(det);
    return wrap;
  }

  /* ---------- the run of show ------------------------------------------- */

  function runOfShow(role, blockId) {
    var d = MRContent.get();
    var frag = document.createDocumentFragment();

    var s = section(null);
    var tbl = el("table", "ros");
    var head = el("thead");
    var hr = el("tr");
    ["Start", "Min", "Segment", "What happens", "Driver"].forEach(function (h) {
      hr.appendChild(el("th", null, h));
    });
    head.appendChild(hr);
    tbl.appendChild(head);
    var tb = el("tbody");
    MRContent.runOfShow(blockId).forEach(function (r) {
      var tr = el("tr");
      if (r.varies) tr.className = "varies";
      tr.appendChild(el("td", "st", r.startLabel));
      tr.appendChild(el("td", "mn", String(r.minutes)));
      tr.appendChild(el("td", "sg", r.segment));
      tr.appendChild(el("td", null, r.what));
      tr.appendChild(el("td", "dr", r.driver));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    s.appendChild(tbl);
    var note = el("p", "printhint",
      "Shown for the " + MRContent.block(blockId).label + " block. The two figures in teal move across " +
      "the year: the senior's block shrinks and the intern's first pass takes up the difference, so " +
      "0:07, 0:16 and 0:22 hold all year.");
    note.style.display = "block";
    s.appendChild(note);
    frag.appendChild(s);

    var g = section("Ground rules");
    g.appendChild(bullets(d.ground_rules));
    frag.appendChild(g);

    var o = section(null);
    var ob = el("div", "note-box");
    ob.appendChild(el("h3", null, d.one_rule.title));
    ob.appendChild(el("p", null, d.one_rule.body));
    o.appendChild(ob);
    frag.appendChild(o);

    var a = section("Today's assignments");
    var at = el("table", "assign");
    var ah = el("thead"), ahr = el("tr");
    (role.assignments || []).forEach(function (h) { ahr.appendChild(el("th", null, h)); });
    ah.appendChild(ahr); at.appendChild(ah);
    var ab = el("tbody"), abr = el("tr");
    (role.assignments || []).forEach(function () { abr.appendChild(el("td")); });
    ab.appendChild(abr); at.appendChild(ab);
    a.appendChild(at);
    frag.appendChild(a);

    var l = section("Escalating the intern across the year");
    l.appendChild(ladderTable(blockId, true));
    frag.appendChild(l);

    return frag;
  }

  /* ---------- the whole card --------------------------------------------- */

  function render(slug, host, date) {
    var d = MRContent.get();
    var role = MRContent.role(slug);
    if (!role) {
      host.appendChild(el("p", "lede", "There is no card called “" + slug + "” in content/roles.json."));
      return;
    }
    var blockId = MRRoster.blockFor(date || MRStore.today()).id;

    document.title = role.name + " | Morning Report";

    var mast = document.querySelector(".card-mast");
    if (mast) {
      mast.querySelector(".fmt").textContent = d.format.title;
      mast.querySelector(".tag").textContent = d.format.tagline;
    }

    var head = el("div", "card-head");
    head.appendChild(el("h1", null, role.name));
    var tagline = MRContent.taglineFor(slug, blockId) || role.tagline;
    if (tagline) head.appendChild(el("span", "card-slot", tagline));
    host.appendChild(head);

    if (role.lede) host.appendChild(el("p", "card-lede", role.lede));

    if (role.is_run_of_show) {
      host.appendChild(runOfShow(role, blockId));
    } else {
      if (role.block_aware) host.appendChild(blockPanel(blockId));

      if (role.before && role.before.length) {
        var b = section("Before report", "before");
        b.appendChild(bullets(role.before));
        host.appendChild(b);
      }
      if (role.during && role.during.length) {
        var du = section(role.during_title || "During report", "during");
        du.appendChild(bullets(role.during));
        host.appendChild(du);
      }
      (role.sections || []).forEach(function (sec) {
        host.appendChild(renderSection(sec, blockId));
      });
      if (role.does_not) {
        var dn = el("div", "does-not");
        dn.id = "does-not";
        dn.appendChild(el("div", "lb", "Does not"));
        dn.appendChild(el("p", null, role.does_not));
        host.appendChild(dn);
      }
      if (role.after) {
        var af = el("div", "after-box");
        af.id = "after";
        af.appendChild(document.createTextNode(role.after));
        host.appendChild(af);
      }
      host.appendChild(strip(role, blockId));
    }

    if (role.prep) {
      var p = el("div", "prep");
      p.appendChild(el("div", "lb", role.prep.title));
      var lines = el("div", "lines");
      for (var i = 0; i < (role.prep.lines || 5); i++) lines.appendChild(el("div"));
      p.appendChild(lines);
      host.appendChild(p);
    }

    // sibling cards, so a facilitator can hop between them
    var nav = el("div", "card-nav");
    d.roles.forEach(function (r) {
      var a = el("a", null, r.name);
      a.href = "../" + r.slug + "/";
      if (r.slug === slug) a.setAttribute("aria-current", "page");
      nav.appendChild(a);
    });
    host.appendChild(nav);

    var hint = el("p", "printhint",
      "Print → Save as PDF reproduces the printed card. Every timing on this page comes from " +
      "content/roles.json, so the web version and the handout cannot drift apart.");
    host.appendChild(hint);
  }

  function boot(slug) {
    var host = document.getElementById("card");
    Promise.all([MRStore.whenReady, MRContent.load()]).then(function () {
      MRStore.mountBar("mr-bar");
      var date = new URLSearchParams(location.search).get("date") || MRStore.today();
      render(slug, host, date);
      if (location.hash) {
        var target = document.getElementById(location.hash.slice(1));
        if (target) target.scrollIntoView({ block: "center" });
      }
    });
  }

  global.MRCard = { render: render, boot: boot };
})(window);
