// src/model.js
var stages = ["Sourced", "Contacted", "Replied", "R1 Scheduled", "R1 Review", "R2 Prep", "R2 Scheduled", "R2 Review", "Reference Check", "Offer / Agreement", "On Hold", "Hired", "Rejected", "Withdrawn"];
var closed = ["Hired", "Rejected", "Withdrawn"];
var milestones = ["First outreach", "Reply received", "Follow-up sent", "R1 completed", "R2 brief sent", "R2 completed", "Writing task completed", "References completed", "Offer sent", "Agreement / NDA signed", "Interview no-show", "Interview cancelled", "Offer declined", "Blocker update", "Commission terms reviewed", "Candidate details corrected", "Document availability checked"];
var checklistItems = [
  ["terms", "Role and payment terms confirmed"],
  ["writing", "Writing / practical task reviewed"],
  ["references", "References checked"],
  ["offer", "Offer accepted"],
  ["agreement", "Agreement completed"],
  ["nda", "NDA completed"]
];
var dateSL = (date = /* @__PURE__ */ new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Colombo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(date);
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = /* @__PURE__ */ new Date(value + "T00:00:00Z");
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}
function stageProblem(payload, candidate, eventDate) {
  if (candidate.job_id === "e2173dde-bc77-409a-96a1-86dcb23841f0" && ["R1 Scheduled", "R1 Review", "R2 Prep", "R2 Scheduled", "R2 Review", "Reference Check", "Offer / Agreement", "Hired"].includes(payload.stage) && (candidate.commission_ack !== "Accepted" || !candidate.terms_detail?.trim())) return "Confirm accepted commission-only terms before advancing this candidate.";
  if (!stages.includes(payload.stage)) return "Choose a valid stage.";
  if (!String(payload.note || "").trim()) return "Add the reason for this update.";
  if (!closed.includes(payload.stage)) {
    if (![payload.action, payload.due, payload.owner].every((v) => typeof v === "string" && v.trim())) return "Set the next action, owner and due date.";
  }
  const slot = payload.stage === "R1 Scheduled" ? payload.r1 : payload.stage === "R2 Scheduled" ? payload.r2 : "";
  if (["R1 Scheduled", "R2 Scheduled"].includes(payload.stage)) {
    if (!slot) return "Set the interview date and time in Sri Lanka time.";
    if (slot.slice(0, 10) < eventDate) return "The interview cannot be earlier than the event date.";
  }
  if (payload.stage === "Hired") {
    const missing = checklistItems.filter(([key]) => !["Complete", "Waived"].includes(candidate.checklist[key]));
    if (missing.length) return "Complete or waive each hiring checklist item before marking Hired.";
    if (!validDate(payload.start_date)) return "Confirm the start date before marking Hired.";
  }
  return "";
}
function recordStates(events) {
  const states = /* @__PURE__ */ new Map();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.kind === "summary" && event.payload.operation && event.payload.target_id)
      states.set(event.payload.target_id, { deleted: event.payload.operation === "delete", revision: event.seq });
  }
  return states;
}
function visibleEvents(events) {
  const states = recordStates(events);
  const replaced = new Set(events.filter((e) => e.payload.supersedes).map((e) => e.payload.supersedes));
  return events.filter((e) => !e.payload.operation && !states.get(e.id)?.deleted && !replaced.has(e.id));
}
function project(events) {
  const states = recordStates(events);
  const visible = new Set(visibleEvents(events).map((e) => e.id));
  const jobs = /* @__PURE__ */ new Map();
  const candidates = /* @__PURE__ */ new Map();
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    const p = event.payload;
    if (p.operation) continue;
    if (!visible.has(event.id) && !(event.kind === "candidate" || event.kind === "job" && !p.job_id)) continue;
    if (p.supersedes && !visible.has(event.id)) continue;
    if (event.kind === "job") {
      if (p.job_id) {
        const job = jobs.get(p.job_id);
        if (job) Object.assign(job, p, { id: p.job_id, revision: event.seq });
      } else {
        jobs.set(event.id, { status: "Open", headcount: "1", ...p, id: event.id, revision: event.seq });
      }
    }
    if (event.kind === "candidate") {
      candidates.set(event.id, {
        ...p,
        id: event.id,
        date: event.event_date,
        revision: event.seq,
        history: [event],
        r1: "",
        r2: "",
        checklist: {},
        documents: { cv: "Missing", cover: "Missing" },
        start_date: ""
      });
    }
    const candidate = candidates.get(event.subject_id);
    if (!candidate) continue;
    candidate.history.push(event);
    candidate.revision = event.seq;
    if (event.kind === "stage") {
      for (const key of ["stage", "action", "due", "owner", "blocker", "r1", "r2", "start_date"]) {
        if (key in p) candidate[key] = p[key];
      }
    }
    if (event.kind === "activity") {
      if (p.event === "Candidate details corrected") {
        for (const key of ["alias", "source", "availability", "notice", "market"]) if (key in p) candidate[key] = p[key];
      }
      if (p.event === "Document availability checked") {
        candidate.documents_checked_at = event.created_at;
        for (const type of ["cv", "cover"]) if (p[type + "_state"]) candidate.documents[type] = p[type + "_state"];
      }
      if (p.event === "Document stored" && ["cv", "cover"].includes(p.document_type)) candidate.documents[p.document_type] = "Receipt saved";
      if (p.event === "Commission terms reviewed") {
        candidate.commission_ack = p.commission_ack;
        candidate.commission_plan = p.commission_plan;
        candidate.terms_detail = p.terms_detail || "";
      }
      if (p.event === "Hiring checklist updated") {
        for (const [key] of checklistItems) {
          if (key in p) candidate.checklist[key] = p[key];
        }
      }
      const completed = {
        "Writing task completed": ["writing"],
        "References completed": ["references"],
        "Agreement / NDA signed": ["agreement", "nda"]
      }[p.event] || [];
      for (const key of completed) candidate.checklist[key] = "Complete";
    }
  }
  for (const job of jobs.values()) job.deleted = Boolean(states.get(job.id)?.deleted);
  for (const candidate of candidates.values()) candidate.deleted = Boolean(states.get(candidate.id)?.deleted);
  for (const event of events) {
    const revision = states.get(event.id)?.revision;
    if (!revision) continue;
    const candidate = candidates.get(event.subject_id || event.id);
    const job = jobs.get(event.payload.job_id || event.id);
    if (candidate) candidate.revision = Math.max(candidate.revision, revision);
    if (job) job.revision = Math.max(job.revision, revision);
  }
  return { jobs: [...jobs.values()].reverse(), candidates: [...candidates.values()].reverse() };
}
function privacyProblem(value) {
  return /[\w.+%-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|www\./i.test(value) || /(?:\+\d[\d() .-]{7,}\d)|(?:\b0\d{9}\b)|(?:\b\d{3}[- .]\d{3}[- .]\d{4}\b)|(?:\b(?:phone|mobile|tel|contact|whatsapp)\s*:?\s*\d[\d() .-]{6,}\d)/i.test(value);
}
function interviewRevision(events, candidate) {
  const stages2 = new Set(events.filter((e) => e.kind === "stage" && e.subject_id === candidate.id).map((e) => e.id));
  return events.reduce((seq, e) => stages2.has(e.id) || e.kind === "summary" && ["delete", "restore"].includes(e.payload.operation) && (e.payload.target_id === candidate.id || stages2.has(e.payload.target_id)) ? Math.max(seq, e.seq) : seq, 0);
}

// node_modules/fflate/esm/browser.js
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i2 = 0; i2 < 31; ++i2) {
    b[i2] = start += 1 << eb[i2 - 1];
  }
  var r = new i32(b[30]);
  for (var i2 = 1; i2 < 30; ++i2) {
    for (var j = b[i2]; j < b[i2 + 1]; ++j) {
      r[j] = j - b[i2] << 5 | i2;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = (function(cd, mb, r) {
  var s = cd.length;
  var i2 = 0;
  var l = new u16(mb);
  for (; i2 < s; ++i2) {
    if (cd[i2])
      ++l[cd[i2] - 1];
  }
  var le = new u16(mb);
  for (i2 = 1; i2 < mb; ++i2) {
    le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        var sv = i2 << 4 | cd[i2];
        var r_1 = mb - cd[i2];
        var v = le[cd[i2] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
      }
    }
  }
  return co;
});
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i2 = 1; i2 < a.length; ++i2) {
    if (a[i2] > m)
      m = a[i2];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i2 = 0; i2 < hcLen; ++i2) {
          clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i2 = 0; i2 < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i2++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i2 - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i2++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i2 = sym - 257, b = fleb[i2];
          add = bits(dat, pos, (1 << b) - 1) + fl[i2];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var et = /* @__PURE__ */ new u8(0);
var b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
};
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
var dutf8 = function(d) {
  for (var r = "", i2 = 0; ; ) {
    var c = d[i2++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i2 + eb > d.length)
      return { s: r, r: slc(d, i2 - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i2++] & 63) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i2++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63);
  }
};
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i2 = 0; i2 < dat.length; i2 += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i2, i2 + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var slzh = function(d, b) {
  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
  var fnl = b2(d, b + 28), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl, bs = b4(d, b + 20);
  var _a2 = z && bs == 4294967295 ? z64e(d, es) : [bs, b4(d, b + 24), b4(d, b + 42)], sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d, b + 10), sc, su, fn, es + b2(d, b + 30) + b2(d, b + 32), off];
};
var z64e = function(d, b) {
  for (; b2(d, b) != 1; b += 4 + b2(d, b + 2))
    ;
  return [b8(d, b + 12), b8(d, b + 4), b8(d, b + 20)];
};
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (; b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  ;
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = o == 4294967295 || c == 65535;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i2 = 0; i2 < c; ++i2) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}

// src/binary.js
function validateDocumentBytes(bytes, extension) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 5 * 1024 * 1024) throw Error("Each document must be 1 byte to 5 MB.");
  if (extension === "pdf") {
    const header = new TextDecoder().decode(bytes.slice(0, 16)), tail = new TextDecoder().decode(bytes.slice(-2048));
    if (!/^%PDF-\d\.\d/.test(header) || !tail.includes("%%EOF") || bytes.length < 40) throw Error("This is not a complete PDF document. Export it again and retry.");
    return;
  }
  if (extension === "doc") {
    const magic = [208, 207, 17, 224, 161, 177, 26, 225];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    if (bytes.length < 1024 || !magic.every((b, i2) => bytes[i2] === b) || view.getUint16(28, true) !== 65534 || ![9, 12].includes(view.getUint16(30, true)) || !new TextDecoder("utf-16le").decode(bytes).includes("WordDocument")) throw Error("This is not a supported Word DOC file. Export it as DOCX or PDF.");
    return;
  }
  if (extension !== "docx") throw Error("Use PDF, DOC or DOCX.");
  let count = 0, total = 0, macro = false, files;
  try {
    files = unzipSync(bytes, { filter: (file) => {
      if (++count > 2048 || (total += file.originalSize) > 32 * 1024 * 1024 || file.originalSize > 16 * 1024 * 1024) throw Error("Oversized archive");
      if (/vbaproject|activex|\.\.\//i.test(file.name)) macro = true;
      return ["[Content_Types].xml", "word/document.xml", "_rels/.rels"].includes(file.name);
    } });
  } catch {
    throw Error("The DOCX archive is damaged or too large when expanded.");
  }
  if (macro || !files["[Content_Types].xml"] || !files["word/document.xml"] || !files["_rels/.rels"] || !strFromU8(files["[Content_Types].xml"]).includes("wordprocessingml.document.main+xml") || !/wordprocessingml\/2006\/main|ooxml.org\/wordprocessingml\/main/.test(strFromU8(files["word/document.xml"]))) throw Error("The file is not a standard DOCX document. Export it again as DOCX or PDF.");
}

// src/api.js
var eventFields = {
  job: {
    required: ["title", "department", "location"],
    optional: ["employment", "headcount", "target_date", "brief", "status", "job_id", "note", "profile", "description"]
  },
  candidate: {
    required: ["alias", "job_id", "source", "stage", "action", "due", "owner"],
    optional: ["availability", "notice", "blocker", "commission_ack", "commission_plan", "market", "terms_detail"]
  },
  stage: {
    required: ["stage", "note"],
    optional: ["action", "due", "owner", "blocker", "r1", "r2", "start_date"]
  },
  activity: {
    required: ["event", "note"],
    optional: ["terms", "writing", "references", "offer", "agreement", "nda", "commission_ack", "commission_plan", "alias", "source", "availability", "notice", "market", "cv_state", "cover_state", "terms_detail"]
  },
  summary: { required: ["progress", "priorities"], optional: ["blockers", "operation", "target_id", "note"] },
  score: {
    required: ["round", "recommendation", "note"],
    optional: ["score1", "score2", "score3", "score4", "reviewer"]
  }
};
for (const fields of Object.values(eventFields)) fields.optional.push("supersedes");
var uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
var apiHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
var json = (value, status = 200) => Response.json(value, { status, headers: apiHeaders });
var error = (message, status = 400) => json({ error: message }, status);
var toEvent = (row) => ({ ...row, payload: JSON.parse(row.payload) });
function validate(record) {
  if (!record || typeof record !== "object") return "Invalid record.";
  const { id, kind, subject_id, event_date, payload, expected_seq } = record;
  if (typeof id !== "string" || !uuid.test(id) || !Object.hasOwn(eventFields, kind) || !validDate(event_date)) {
    return "Choose a valid record type and event date.";
  }
  if (expected_seq !== void 0 && (!Number.isSafeInteger(expected_seq) || expected_seq < 0)) {
    return "Refresh this record before updating it.";
  }
  const linked = ["stage", "activity", "score"].includes(kind);
  if (linked ? typeof subject_id !== "string" || !uuid.test(subject_id) : subject_id !== null) {
    return "Select an existing candidate.";
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Invalid fields.";
  const { required, optional } = eventFields[kind];
  if (payload.operation && (kind !== "summary" || !["delete", "restore"].includes(payload.operation) || !uuid.test(payload.target_id || "") || !payload.note?.trim() || payload.supersedes)) return "Choose a record and a deletion or restoration reason.";
  if (!payload.operation && required.some((key) => typeof payload[key] !== "string" || !payload[key].trim())) {
    return "Complete all required fields.";
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!required.includes(key) && !optional.includes(key) || typeof value !== "string" || value.length > (key === "description" ? 12e3 : 600)) {
      return "Invalid field or text longer than 600 characters.";
    }
    if (privacyProblem(value)) return "Public records must omit names, phone numbers, email addresses and links. Use candidate codes.";
    if (["due", "start_date", "target_date"].includes(key) && value && !validDate(value)) return "Choose a valid date.";
    if (["r1", "r2"].includes(key) && value) {
      if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || !validDate(value.slice(0, 10))) {
        return "Choose a valid interview date and time.";
      }
    }
    if (key.startsWith("score") && !["", "1", "2", "3", "4", "5"].includes(value)) return "Scores must be 1 to 5.";
  }
  if (payload.supersedes && !uuid.test(payload.supersedes)) return "Choose an existing record to edit.";
  if (payload.owner && !["COO", "Leadership", "Candidate"].includes(payload.owner)) return "Choose a valid action owner.";
  if (kind === "job") {
    if (payload.job_id && (!uuid.test(payload.job_id) || !payload.note?.trim())) return "Add a reason for the position update.";
    if (payload.status && !["Open", "Paused", "Closed"].includes(payload.status)) return "Choose a valid position status.";
    if (payload.headcount && !/^[1-9]\d{0,2}$/.test(payload.headcount)) return "Headcount must be 1 to 999.";
  }
  if (payload.commission_ack && !["Pending", "Accepted", "Declined"].includes(payload.commission_ack)) return "Choose a valid commission acknowledgement.";
  if (payload.commission_plan && !["10 / 20 / 30 recurring", "Other agreed terms"].includes(payload.commission_plan)) return "Choose a valid commission plan.";
  if (payload.profile && payload.profile !== "client-acquisition-v1") return "Choose a valid role profile.";
  if (payload.source && !["Headhunting", "Referral", "Inbound", "Other"].includes(payload.source)) return "Choose a valid source.";
  if (payload.availability && !["To confirm", "Available now", "Within 2 weeks", "Within 1 month", "Later"].includes(payload.availability)) return "Choose a valid availability.";
  if (payload.reviewer && !["COO", "Leadership"].includes(payload.reviewer)) return "Choose a valid reviewer role.";
  if (kind === "candidate") {
    if (payload.stage !== "Sourced" || !uuid.test(payload.job_id)) return "Select a position and start at Sourced.";
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(payload.alias)) return "Use a unique candidate code, such as QE-001 (2 to 40 characters).";
  }
  if (kind === "activity") {
    if (payload.event === "Candidate details corrected") {
      if (!payload.alias || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(payload.alias) || !payload.source || !payload.availability || !payload.notice) return "Complete the corrected candidate details.";
    } else if (payload.event === "Document availability checked") return "Document checks are generated by the private storage service.";
    else if (payload.event === "Hiring checklist updated") {
      if (checklistItems.some(([key]) => !["Pending", "Complete", "Waived"].includes(payload[key]))) {
        return "Set every hiring checklist item.";
      }
    } else if (payload.event === "Commission terms reviewed" && (!["Pending", "Accepted", "Declined"].includes(payload.commission_ack) || !payload.commission_plan || !payload.terms_detail?.trim())) return "Confirm the candidate\u2019s commission acknowledgement.";
    else if (!milestones.includes(payload.event)) return "Choose a valid milestone.";
  }
  if (kind === "score") {
    if (!["R1", "R2"].includes(payload.round) || !["Advance", "Hold", "Reject"].includes(payload.recommendation)) {
      return "Choose a valid scorecard round and recommendation.";
    }
    if (![1, 2, 3, 4].some((i2) => payload["score" + i2])) return "Score at least one tested criterion.";
  }
  return "";
}
async function readRecord(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let bytes = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 65536) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(await new Blob(chunks).text());
  } catch {
    return null;
  }
}
async function jobHistory(db, id) {
  const rows = await db.prepare("SELECT * FROM recruitment_events ORDER BY seq").all();
  return project(rows.results.map(toEvent)).jobs.find((j) => j.id === id);
}
function sameRecord(saved, record) {
  return saved.kind === record.kind && saved.subject_id === record.subject_id && saved.event_date === record.event_date && JSON.stringify(Object.entries(saved.payload).sort(([a], [b]) => a.localeCompare(b))) === JSON.stringify(Object.entries(record.payload).sort(([a], [b]) => a.localeCompare(b)));
}
async function api(request, env, url) {
  if (!["GET", "POST"].includes(request.method)) {
    return new Response(null, { status: 405, headers: { ...apiHeaders, Allow: "GET, POST, OPTIONS" } });
  }
  if (!env.DB) return error("Shared storage is unavailable. Please retry.", 503);
  const db = env.DB.withSession("first-primary");
  if (request.method === "GET") {
    const after = Number(url.searchParams.get("after") || 0);
    if (!Number.isSafeInteger(after) || after < 0) return error("Invalid event cursor.");
    const clauses = ["seq > ?"];
    const args = [after];
    if (url.searchParams.has("date")) {
      const date = url.searchParams.get("date");
      if (!validDate(date)) return error("Invalid report date.");
      clauses.push("event_date=?");
      args.push(date);
    }
    if (url.searchParams.has("subject")) {
      const subject = url.searchParams.get("subject");
      if (!uuid.test(subject || "")) return error("Invalid candidate.");
      clauses.push("(id=? OR subject_id=? OR kind='summary' AND json_extract(payload,'$.operation') IS NOT NULL)");
      args.push(subject, subject);
    }
    const rows = await db.prepare("SELECT * FROM recruitment_events WHERE " + clauses.join(" AND ") + " ORDER BY seq LIMIT 500").bind(...args).all();
    return json(rows.results.map(toEvent));
  }
  const record = await readRecord(request);
  const problem = validate(record);
  if (problem) return error(problem);
  const { id, kind, subject_id, event_date, payload } = record;
  const previous = await db.prepare("SELECT * FROM recruitment_events WHERE id=?").bind(id).first();
  if (previous) {
    const saved2 = toEvent(previous);
    return sameRecord(saved2, record) ? json(saved2, 200) : error("This save ID already belongs to another record.", 409);
  }
  const allRows = await db.prepare("SELECT * FROM recruitment_events ORDER BY seq").all();
  const allEvents = allRows.results.map(toEvent), currentState = project(allEvents), states = recordStates(allEvents);
  const head = allEvents.at(-1)?.seq || 0;
  if (payload.operation) {
    const target = allEvents.find((e) => e.id === payload.target_id);
    if (!target || target.payload.operation) return error("Choose an existing record.");
    const targetRevision = Math.max(states.get(target.id)?.revision || target.seq, currentState.candidates.find((c) => c.id === target.id)?.revision || 0, currentState.jobs.find((j) => j.id === target.id)?.revision || 0);
    if (record.expected_seq !== targetRevision) return error("This record changed. Reopen it before continuing.", 409);
    const deleted = Boolean(states.get(target.id)?.deleted);
    if (deleted === (payload.operation === "delete")) return error(deleted ? "Record is already in Trash." : "Record is already restored.", 409);
    if (payload.operation === "restore") {
      const parent = currentState.candidates.find((c) => c.id === target.subject_id);
      if (parent?.deleted) return error("Restore the candidate before restoring its history.");
    }
  }
  if (payload.operation) {
    const proposed = project([...allEvents, { ...record, seq: head + 1 }]).candidates.filter((c) => !c.deleted && ["R1 Scheduled", "R2 Scheduled"].includes(c.stage));
    for (let i2 = 0; i2 < proposed.length; i2++) for (let j = i2 + 1; j < proposed.length; j++) {
      const interval = (c2) => {
        const r = c2.stage === "R1 Scheduled" ? "r1" : "r2", start = +/* @__PURE__ */ new Date(c2[r] + ":00+05:30");
        return [start, start + (r === "r1" ? 30 : 60) * 6e4];
      };
      const [a, b] = interval(proposed[i2]), [c, d] = interval(proposed[j]);
      if (a < d && c < b) return error("This change would restore an overlapping interview. Reschedule the current booking first.", 409);
    }
  }
  if (payload.supersedes) {
    const original = allEvents.find((e) => e.id === payload.supersedes);
    if (!original || original.kind !== kind || original.subject_id !== subject_id || ["candidate", "job"].includes(kind) || original.payload.operation || !visibleEvents(allEvents).some((e) => e.id === original.id)) return error("This entry cannot be edited. Refresh and try again.", 409);
    if (kind === "summary" && record.expected_seq !== (states.get(original.id)?.revision || original.seq)) return error("Summary changed. Reopen it.", 409);
  }
  const conditions = ["COALESCE((SELECT MAX(seq) FROM recruitment_events),0)=?"];
  const parameters = [id, kind, subject_id, event_date, JSON.stringify(payload), head];
  if ((subject_id || kind === "job" && payload.job_id) && record.expected_seq === void 0) return error("A current record revision is required. Refresh and retry.", 409);
  if (subject_id) {
    const candidate = currentState.candidates.find((c) => c.id === subject_id);
    if (!candidate) return error("Select an existing candidate.");
    if (candidate.deleted) return error("Restore this candidate from Trash before updating it.");
    if (record.expected_seq !== candidate.revision) return error("Candidate changed. Reopen it before saving.", 409);
    if (kind === "activity" && payload.event === "Candidate details corrected") {
      conditions.push("NOT EXISTS (SELECT 1 FROM recruitment_events e WHERE lower(trim(json_extract(e.payload,'$.alias')))=lower(?) AND (e.kind='candidate' OR e.kind='activity' AND json_extract(e.payload,'$.event')='Candidate details corrected') AND COALESCE(e.subject_id,e.id)<>?)");
      parameters.push(payload.alias, subject_id);
    }
    if (kind === "stage") {
      const stageError = stageProblem(payload, candidate, event_date);
      if (stageError) return error(stageError);
      if (["R1 Scheduled", "R2 Scheduled"].includes(payload.stage)) {
        const slot = payload.stage === "R1 Scheduled" ? payload.r1 : payload.r2;
        const duration = payload.stage === "R1 Scheduled" ? 30 : 60;
        const start = +/* @__PURE__ */ new Date(slot + ":00+05:30"), end = start + duration * 6e4;
        const overlap = currentState.candidates.some((c) => !c.deleted && c.id !== subject_id && ["R1 Scheduled", "R2 Scheduled"].includes(c.stage) && (() => {
          const r = c.stage === "R1 Scheduled" ? "r1" : "r2", t = +/* @__PURE__ */ new Date(c[r] + ":00+05:30");
          return t < end && t + (r === "r1" ? 30 : 60) * 6e4 > start;
        })());
        if (overlap) return error("This interview overlaps another COO booking. Choose another time.", 409);
      }
    }
  }
  if (kind === "job" && payload.job_id) {
    const job = await jobHistory(db, payload.job_id);
    if (!job) return error("Select an existing position.");
    if (job.deleted) return error("Restore the position from Trash before editing.");
    if (record.expected_seq !== job.revision) return error("Position changed. Reopen it before saving.", 409);
  }
  if (kind === "candidate") {
    const job = await jobHistory(db, payload.job_id);
    if (!job || job.deleted || job.status !== "Open") return error("Choose an open position.");
    if (job.profile === "client-acquisition-v1" && (!["Pending", "Accepted", "Declined"].includes(payload.commission_ack) || !payload.commission_plan || payload.commission_ack === "Accepted" && !payload.terms_detail?.trim())) return error("Record the commission structure and candidate acknowledgement.");
    conditions.push("NOT EXISTS (SELECT 1 FROM recruitment_events WHERE (kind='candidate' OR kind='activity' AND json_extract(payload,'$.event')='Candidate details corrected') AND lower(trim(json_extract(payload,'$.alias')))=lower(?))");
    parameters.push(payload.alias);
    conditions.push("COALESCE((SELECT json_extract(payload,'$.status') FROM recruitment_events WHERE kind='job' AND (id=? OR json_extract(payload,'$.job_id')=?) ORDER BY seq DESC LIMIT 1),'Open')='Open'");
    parameters.push(job.id, job.id);
  }
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  await db.prepare(
    "INSERT INTO recruitment_events (id,kind,subject_id,event_date,payload) SELECT ?,?,?,?,?" + where + " ON CONFLICT(id) DO NOTHING"
  ).bind(...parameters).run();
  const row = await db.prepare("SELECT * FROM recruitment_events WHERE id=?").bind(id).first();
  if (!row) {
    return error(kind === "candidate" ? "Candidate code already exists, or the position has closed. Refresh and check." : "The record changed or this interview overlaps another COO booking. Refresh and choose an available slot.", 409);
  }
  const saved = toEvent(row);
  return sameRecord(saved, record) ? json(saved, 201) : error("Save ID conflict. Refresh and retry.", 409);
}
async function bootstrap(env) {
  if (!env.DB) return error("Shared storage is unavailable.", 503);
  const db = env.DB.withSession("first-primary");
  const head = await db.prepare("SELECT COALESCE(MAX(seq),0) AS cursor FROM recruitment_events").first();
  const rows = await db.prepare("SELECT * FROM recruitment_events WHERE seq<=? ORDER BY seq").bind(head.cursor).all();
  return json({ events: rows.results.map(toEvent), cursor: head.cursor });
}
var validDriveEndpoint = (value) => /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value || "");
var driveConfigured = (env) => validDriveEndpoint(env.DRIVE_WEB_APP_URL) && typeof env.DRIVE_WEB_APP_SECRET === "string" && env.DRIVE_WEB_APP_SECRET.length >= 32;
async function boundedJson(request, limit) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(await new Blob(chunks).text());
  } catch {
    return null;
  }
}
async function driveHealth(env, candidateId) {
  if (!driveConfigured(env)) return json({ drive_ready: false, configured: false });
  try {
    const response = await fetch(env.DRIVE_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "health", candidate_id: candidateId || void 0, secret: env.DRIVE_WEB_APP_SECRET }),
      redirect: "follow",
      signal: AbortSignal.timeout(15e3)
    });
    const result = await response.json();
    return json({ drive_ready: response.ok && result.ok === true && result.ready === true && result.protocol === 3, configured: true });
  } catch {
    return json({ drive_ready: false, configured: true });
  }
}
async function uploadFingerprint(input, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify([input.candidate_id, input.document_type, input.name.trim(), input.extension, input.data])));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function documentApi(request, env) {
  if (request.method !== "POST") return error("Use POST to upload a document.", 405);
  if (!driveConfigured(env)) return error("Google Drive upload needs owner setup. Your candidate record is safe; no document has been uploaded.", 503);
  if (!env.DB) return error("Shared storage is unavailable.", 503);
  const input = await boundedJson(request, 7.1 * 1024 * 1024);
  if (!input || !uuid.test(input.id || "") || !uuid.test(input.candidate_id || "") || !["cv", "cover"].includes(input.document_type) || !["pdf", "doc", "docx"].includes(input.extension) || typeof input.name !== "string" || input.name.trim().length < 2 || input.name.trim().length > 120 || /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(input.name) || typeof input.data !== "string" || input.data.length > 6990508 || (input.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data))) {
    return error("Enter the candidate name and choose a valid PDF, DOC or DOCX up to 5 MB.");
  }
  let raw;
  try {
    raw = atob(input.data);
  } catch {
    return error("Invalid document encoding.");
  }
  const fingerprint = await uploadFingerprint(input, env.DRIVE_WEB_APP_SECRET);
  if (raw.length === 0 || raw.length > 5 * 1024 * 1024) return error("Each document must be 1 byte to 5 MB.");
  try {
    validateDocumentBytes(Uint8Array.from(raw, (c) => c.charCodeAt(0)), input.extension);
  } catch (err2) {
    return error(err2.message);
  }
  const db = env.DB.withSession("first-primary");
  const candidate = await candidateRecord(db, input.candidate_id);
  if (!candidate) return error("Save the candidate before uploading documents.", 404);
  const duplicate = await db.prepare("SELECT * FROM recruitment_events WHERE id=?").bind(input.id).first();
  if (duplicate) {
    const saved = toEvent(duplicate);
    return saved.kind === "activity" && saved.subject_id === input.candidate_id && saved.payload.event === "Document stored" && saved.payload.document_type === input.document_type && saved.payload.upload_fingerprint === fingerprint ? json({ event: saved, uploaded: true }) : error("This upload request ID is already in use.", 409);
  }
  const position = await jobHistory(db, candidate.job_id);
  if (!position || position.profile !== "client-acquisition-v1") return error("This upload is for the Client Acquisition & Client Relations position.");
  const payload = { event: "Document stored", upload_fingerprint: fingerprint, document_type: input.document_type, note: (input.document_type === "cv" ? "CV" : "Cover letter") + " stored in private Drive. Verify current availability before relying on this receipt." };
  await db.prepare("INSERT INTO document_outbox (id,candidate_id,fingerprint,document_type,event_date,payload) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(input.id, input.candidate_id, fingerprint, input.document_type, dateSL(), JSON.stringify(payload)).run();
  const job = await db.prepare("SELECT * FROM document_outbox WHERE id=?").bind(input.id).first();
  if (job.fingerprint !== fingerprint) return error("This request belongs to a different document. Reopen the panel to create a new upload.", 409);
  try {
    const result = await bridgeRequest(env, { ...input, alias: candidate.alias, fingerprint }, 6e4);
    if (result.document_type !== input.document_type) throw Error("Drive returned a mismatched document receipt.");
    const event = await finalizeDocument(db, job);
    return json({ event, uploaded: true }, 201);
  } catch (err2) {
    return error(err2.message + " Keep this file selected and retry. Confirmed Drive uploads are also reconciled automatically.", 502);
  }
}
async function rateLimit(request, env, path) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || !env.DB) return null;
  const category = path === "/api/documents" ? "upload" : path === "/api/events" ? "write" : "drive";
  const span = category === "upload" ? 600 : 60, limit = category === "upload" ? 20 : category === "write" ? 60 : 30;
  const hash = await uploadFingerprint({ candidate_id: "rate", document_type: category, name: ip, extension: "", data: "" }, env.DRIVE_WEB_APP_SECRET || "local-development-rate-limit-key");
  const bucket = category + ":" + hash + ":" + Math.floor(Date.now() / 1e3 / span);
  const row = await env.DB.prepare("INSERT INTO request_buckets(bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count").bind(bucket).first();
  if (row.count > limit) {
    const response = error("Too many requests. Please wait and retry. Your existing records are preserved.", 429);
    response.headers.set("Retry-After", String(span));
    return response;
  }
  return null;
}
async function bridgeRequest(env, body, timeout = 2e4) {
  if (!driveConfigured(env)) throw Error("Drive is not configured.");
  const response = await fetch(env.DRIVE_WEB_APP_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, secret: env.DRIVE_WEB_APP_SECRET }), redirect: "follow", signal: AbortSignal.timeout(timeout) });
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error("Drive returned an invalid response.");
  }
  if (!response.ok || result?.ok !== true) throw Error(result?.code === "PUBLIC_FOLDER" ? "Restrict the Drive destination before uploading." : result?.code === "LOCATION_CHANGED" ? "The candidate folder moved outside the recruitment destination. Restore its location before uploading." : "Drive did not confirm this operation. Check authorization and folder permissions.");
  return result;
}
async function candidateRecord(db, id) {
  const rows = await db.prepare("SELECT * FROM recruitment_events WHERE id=? OR subject_id=? ORDER BY seq").bind(id, id).all();
  return project(rows.results.map(toEvent)).candidates[0];
}
async function finalizeDocument(db, job) {
  await db.prepare("INSERT INTO recruitment_events (id,kind,subject_id,event_date,payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(job.id, "activity", job.candidate_id, job.event_date, job.payload).run();
  const saved = await db.prepare("SELECT * FROM recruitment_events WHERE id=?").bind(job.id).first();
  if (!saved || saved.kind !== "activity" || saved.subject_id !== job.candidate_id || toEvent(saved).payload.document_type !== job.document_type || toEvent(saved).payload.upload_fingerprint !== job.fingerprint) throw Error("Receipt conflict; contact the owner.");
  await db.prepare("UPDATE document_outbox SET state='complete' WHERE id=?").bind(job.id).run();
  return toEvent(saved);
}
async function documentStatus(request, env, url) {
  if (!["GET", "POST"].includes(request.method)) return error("Use GET or POST.", 405);
  const input = request.method === "POST" ? await boundedJson(request, 1500) : { candidate_id: url.searchParams.get("candidate_id") };
  if (!input || !uuid.test(input.candidate_id || "") || request.method === "POST" && !uuid.test(input.id || "")) return error("Choose a candidate.");
  const db = env.DB.withSession("first-primary"), candidate = await candidateRecord(db, input.candidate_id);
  if (!candidate) return error("Candidate not found.", 404);
  let result;
  try {
    result = await bridgeRequest(env, { action: "status", candidate_id: candidate.id });
  } catch (err2) {
    return error(err2.message, 502);
  }
  if (!["Available", "Missing"].includes(result.cv) || !["Available", "Missing"].includes(result.cover)) return error("Drive status could not be verified.", 502);
  const response = { cv: result.cv, cover: result.cover, checked_at: (/* @__PURE__ */ new Date()).toISOString() };
  if (request.method === "POST") {
    const payload = { event: "Document availability checked", cv_state: result.cv, cover_state: result.cover, note: "Private storage checked; these are statuses at the recorded check time." };
    await db.prepare("INSERT INTO recruitment_events (id,kind,subject_id,event_date,payload) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(input.id, "activity", candidate.id, dateSL(), JSON.stringify(payload)).run();
    const row = await db.prepare("SELECT * FROM recruitment_events WHERE id=?").bind(input.id).first();
    if (!row || row.subject_id !== candidate.id || row.kind !== "activity" || toEvent(row).payload.event !== "Document availability checked") return error("Status request ID conflict.", 409);
    response.event = toEvent(row);
  }
  return json(response);
}
async function maintenance(env) {
  if (!env.DB || !driveConfigured(env)) return;
  const db = env.DB.withSession("first-primary");
  const scan = await db.prepare("SELECT value FROM maintenance_state WHERE key='outbox_scan_cursor'").first();
  let jobs = await db.prepare("SELECT * FROM document_outbox WHERE state='pending' AND id>? ORDER BY id LIMIT 10").bind(scan?.value || "").all();
  if (!jobs.results.length) jobs = await db.prepare("SELECT * FROM document_outbox WHERE state='pending' ORDER BY id LIMIT 10").all();
  for (const job of jobs.results) {
    try {
      const receipt = await bridgeRequest(env, { action: "receipt", id: job.id, candidate_id: job.candidate_id, fingerprint: job.fingerprint });
      if (receipt.uploaded === true && receipt.document_type === job.document_type) await finalizeDocument(db, job);
    } catch {
      console.warn("Document reconciliation will retry.");
    }
  }
  if (jobs.results.length) await db.prepare("INSERT INTO maintenance_state(key,value) VALUES ('outbox_scan_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(jobs.results.at(-1).id).run();
  const state = await db.prepare("SELECT value FROM maintenance_state WHERE key='backup_cursor'").first();
  const cursor = Number(state?.value || 0);
  const rows = await db.prepare("SELECT * FROM recruitment_events WHERE seq>? ORDER BY seq LIMIT 500").bind(cursor).all();
  if (rows.results.length) {
    const records = rows.results.map(toEvent), last = records.at(-1).seq;
    const receipt = await bridgeRequest(env, { action: "backup", first: records[0].seq, last, records }, 6e4);
    if (receipt.saved !== true || receipt.last !== last) throw Error("Backup receipt mismatch; cursor was not advanced.");
    await db.prepare("INSERT INTO maintenance_state(key,value) VALUES ('backup_cursor',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(last)).run();
  }
  await db.prepare("INSERT INTO maintenance_state(key,value) VALUES ('last_success',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind((/* @__PURE__ */ new Date()).toISOString()).run();
}
async function maintenanceStatus(request, env) {
  if (request.method !== "GET") return error("Use GET.", 405);
  const rows = await env.DB.prepare("SELECT key,value FROM maintenance_state").all();
  const values = Object.fromEntries(rows.results.map((r) => [r.key, r.value]));
  const pending = await env.DB.prepare("SELECT COUNT(*) AS count FROM document_outbox WHERE state='pending'").first();
  return json({ last_success: values.last_success || null, backup_cursor: Number(values.backup_cursor || 0), pending_receipts: pending.count });
}
var reminderRecipient = "prasad.quidedge@gmail.com";
function bookingSeq(c) {
  return c.booking_seq || 0;
}
function meetingSlot(c) {
  const round = c?.stage === "R1 Scheduled" ? "R1" : c?.stage === "R2 Scheduled" ? "R2" : "";
  return round && c[round.toLowerCase()] ? { round, slot: c[round.toLowerCase()] } : null;
}
function zoomProblem(value) {
  try {
    const u = new URL(value);
    return u.protocol !== "https:" || u.username || u.password || !(u.hostname === "zoom.us" || u.hostname.endsWith(".zoom.us")) || !/^\/(j|my|s)\//.test(u.pathname) || value.length > 1500;
  } catch {
    return true;
  }
}
async function meetingCandidates(db) {
  const rows = await db.prepare("SELECT * FROM recruitment_events ORDER BY seq").all();
  const history = rows.results.map(toEvent);
  return project(history).candidates.map((c) => ({ ...c, booking_seq: interviewRevision(history, c) }));
}
async function interviewApi(request, env, url) {
  const db = env.DB.withSession("first-primary");
  if (request.method === "GET") {
    const rows = await db.prepare("SELECT key,value FROM maintenance_state WHERE key LIKE 'interview:%'").all();
    let emailReady = false;
    try {
      emailReady = (await bridgeRequest(env, { action: "health", email: true })).email_ready === true;
    } catch {
    }
    return json({ recipient: reminderRecipient, email_ready: emailReady, meetings: rows.results.map((r) => JSON.parse(r.value)) });
  }
  if (request.method !== "POST") return error("Use GET or POST.", 405);
  const p = await boundedJson(request, 5e3);
  if (!p || !uuid.test(p.candidate_id || "") || typeof p.enabled !== "boolean" || typeof p.zoom !== "string" || typeof p.remind_at !== "string") return error("Invalid interview settings.");
  const c = (await meetingCandidates(db)).find((c2) => c2.id === p.candidate_id), booking = meetingSlot(c);
  if (!booking || booking.slot !== p.slot || booking.round !== p.round) return error("The booking changed. Refresh and reopen its meeting details.", 409);
  if (p.zoom && zoomProblem(p.zoom)) return error("Use a valid HTTPS Zoom meeting link (zoom.us).");
  const at = Date.parse(p.remind_at + ":00+05:30"), start = Date.parse(booking.slot + ":00+05:30");
  if (p.enabled && (!p.zoom || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(p.remind_at) || !Number.isFinite(at) || new Date(at + 330 * 6e4).toISOString().slice(0, 16) !== p.remind_at || at <= Date.now() || at >= start)) return error("Choose a future reminder time before the interview and add its Zoom link.");
  const key = "interview:" + c.id, old = await db.prepare("SELECT value FROM maintenance_state WHERE key=?").bind(key).first();
  const prior = old ? JSON.parse(old.value) : null;
  if ((prior?.version || "") !== (p.version || "")) return error("Meeting details changed in another window. Reopen and retry.", 409);
  const same = prior && prior.slot === p.slot && prior.round === p.round && prior.zoom === p.zoom && prior.remind_at === p.remind_at && prior.enabled === p.enabled && prior.booking_seq === bookingSeq(c);
  if (same) return json(prior);
  const value = { candidate_id: c.id, ...booking, booking_seq: bookingSeq(c), zoom: p.zoom, enabled: p.enabled, remind_at: p.enabled ? p.remind_at : "", version: crypto.randomUUID(), status: p.enabled ? "pending" : "disabled", updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  const result = await db.prepare("INSERT INTO maintenance_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE maintenance_state.value=? RETURNING value").bind(key, JSON.stringify(value), old?.value || "").first();
  if (!result) return error("Meeting details changed. Reopen and retry.", 409);
  return json(value);
}
async function dispatchInterviewReminders(env) {
  if (!env.DB || !driveConfigured(env)) return;
  const db = env.DB.withSession("first-primary"), rows = await db.prepare("SELECT key,value FROM maintenance_state WHERE key LIKE 'interview:%'").all();
  for (const row of rows.results) {
    let m;
    try {
      m = JSON.parse(row.value);
    } catch {
      continue;
    }
    if (!m.enabled || !["pending", "awaiting-activation"].includes(m.status) || Date.parse(m.remind_at + ":00+05:30") > Date.now()) continue;
    const c = (await meetingCandidates(db)).find((c2) => c2.id === m.candidate_id), b = meetingSlot(c);
    let status = !b || b.slot !== m.slot || b.round !== m.round || bookingSeq(c) !== m.booking_seq ? "cancelled" : Date.parse(m.slot + ":00+05:30") <= Date.now() ? "expired" : "";
    if (status) {
      await db.prepare("UPDATE maintenance_state SET value=? WHERE key=? AND value=?").bind(JSON.stringify({ ...m, status }), row.key, row.value).run();
      continue;
    }
    let mailReady = false;
    try {
      mailReady = (await bridgeRequest(env, { action: "health", email: true })).email_ready === true;
    } catch {
    }
    if (!mailReady) {
      await db.prepare("UPDATE maintenance_state SET value=? WHERE key=? AND value=?").bind(JSON.stringify({ ...m, status: "awaiting-activation" }), row.key, row.value).run();
      continue;
    }
    const claimed = { ...m, status: "sending" };
    const claim = await db.prepare("UPDATE maintenance_state SET value=? WHERE key=? AND value=? RETURNING key").bind(JSON.stringify(claimed), row.key, row.value).first();
    if (!claim) continue;
    try {
      const result = await bridgeRequest(env, { action: "interview-email", candidate_id: c.id, id: m.version, alias: c.alias, role: "Client Acquisition & Client Relations Specialist", round: m.round, slot: m.slot, zoom: m.zoom }, 45e3);
      status = result.sent === true ? "sent" : "needs-review";
    } catch {
      status = "needs-review";
    }
    await db.prepare("UPDATE maintenance_state SET value=? WHERE key=? AND value=?").bind(JSON.stringify({ ...claimed, status, processed_at: (/* @__PURE__ */ new Date()).toISOString() }), row.key, JSON.stringify(claimed)).run();
  }
}
var api_default = {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(dispatchInterviewReminders(env));
    if (!controller.scheduledTime || new Date(controller.scheduledTime).getUTCMinutes() % 10 === 0) ctx.waitUntil(maintenance(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (["/api/interviews", "/api/events", "/api/documents", "/api/integrations", "/api/bootstrap", "/api/document-status", "/api/maintenance"].includes(url.pathname)) {
      const origin = request.headers.get("Origin");
      const allowed = origin === "https://levigamage06.github.io" || origin === "https://quidedge-hire.pages.dev" || origin === url.origin;
      if (origin && !allowed) return error("This origin is not allowed.", 403);
      const corsHeaders = allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: {
          ...apiHeaders,
          ...corsHeaders,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "600"
        } });
      }
      let response;
      try {
        if (request.method === "POST" || ["/api/integrations", "/api/document-status", "/api/maintenance"].includes(url.pathname)) {
          const limited = await rateLimit(request, env, url.pathname);
          if (limited) {
            for (const [key, value] of Object.entries(corsHeaders)) limited.headers.set(key, value);
            return limited;
          }
        }
        response = url.pathname === "/api/interviews" ? await interviewApi(request, env, url) : url.pathname === "/api/maintenance" ? await maintenanceStatus(request, env) : url.pathname === "/api/bootstrap" ? request.method === "GET" ? await bootstrap(env) : error("Use GET.", 405) : url.pathname === "/api/document-status" ? await documentStatus(request, env, url) : url.pathname === "/api/events" ? await api(request, env, url) : url.pathname === "/api/documents" ? await documentApi(request, env) : request.method === "GET" ? await driveHealth(env, url.searchParams.get("candidate_id")) : error("Method not allowed.", 405);
      } catch {
        response = error("Shared storage is temporarily unavailable. Please retry.", 503);
      }
      const result = new Response(response.body, response);
      for (const [key, value] of Object.entries(corsHeaders)) result.headers.set(key, value);
      return result;
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!Object.hasOwn(ASSETS, path)) return new Response("Not found", { status: 404 });
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    const asset = ASSETS[path];
    const cache = "no-cache";
    return new Response(request.method === "HEAD" ? null : asset.body, {
      headers: { "Content-Type": asset.type, "Cache-Control": cache, "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" }
    });
  }
};
var ASSETS = { "/index.html": { "body": '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="theme-color" content="#efefe2">\n<title>QuidEdge \xB7 Recruitment</title>\n<link rel="stylesheet" href="./styles.css?v=5ea8864332e1">\n</head>\n<body>\n<a class="skip" href="#app">Skip to recruitment workspace</a>\n<header class="top">\n  <a href="#overview" class="brand"><span class="mark" aria-hidden="true">\u273A</span>quidedge<span class="brand-dot">.</span></a>\n  <nav aria-label="Recruitment navigation" id="nav">\n    <a href="#overview">Overview</a><a href="#coo">COO workspace</a><a href="#role">Hiring role</a><a href="#pipeline">Pipeline</a><a href="#activity">Daily activity</a><a href="#interviews">Interviews</a><a href="#guide">Interview guide</a><a href="#trash">Trash</a>\n  </nav>\n  <button id="sync" class="pill" type="button" title="Refresh data"><span class="indicator"></span><span id="mode">Connecting</span></button>\n</header>\n<main>\n  <div id="app" tabindex="-1"></div>\n</main>\n<dialog id="dialog" aria-labelledby="dialog-title"></dialog>\n<div id="notice" role="status" aria-live="polite"></div>\n<script type="module" src="./app.js?v=5ea8864332e1"><\/script>\n</body>\n</html>\n', "type": "text/html; charset=utf-8" }, "/styles.css": { "body": ":root{color-scheme:light;--ink:#191b17;--muted:#64675c;--paper:#fafaf3;--line:#dedfd3;--gold:#f8c87c;--amber:#d99c44;--blue:#6587e7;--coral:#e68d72;--purple:#ae6bd9;--green:#72b580;font-family:Inter,Aptos,system-ui,sans-serif;color:var(--ink);background:#eeeee1}\n*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 8% 0,#e8ede5,transparent 62%),radial-gradient(ellipse at 100% 27%,#f7efdc,transparent 65%);min-height:100vh}a{color:inherit}button,input,select,textarea{font:inherit}button,a,input,select,textarea{outline-offset:4px}button{cursor:pointer}button:disabled{cursor:wait;opacity:.55}.top{min-height:78px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px clamp(16px,3vw,46px);flex-wrap:wrap}.brand{text-decoration:none;font-size:clamp(24px,3vw,36px);font-weight:800;letter-spacing:-.075em;display:flex;align-items:center;gap:8px}.brand-dot{color:#bb651f;margin-left:-6px}.mark{color:#be651f;font-size:1.2em;line-height:1}.top nav{display:flex;gap:5px;flex-wrap:wrap}.top nav a,.pill,.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:999px;padding:10px 16px;border:1px solid var(--line);text-decoration:none;background:var(--paper);color:var(--ink);font-size:.86rem;white-space:nowrap}.top nav a.active{background:var(--ink);color:white;border-color:var(--ink)}.indicator{width:8px;height:8px;border-radius:100%;background:#aa6b23}.live .indicator{background:#398449}.error .indicator{background:#a5332b}.btn.primary{background:var(--gold);border-color:transparent;font-weight:650}.btn:hover,.pill:hover{filter:brightness(.96)}main{max-width:1600px;margin:auto;padding:18px clamp(16px,3vw,46px) 52px}.intro,.section-top,.form-actions,.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.intro{margin-bottom:20px}.intro h1{font-size:clamp(31px,4vw,52px);line-height:1.02;letter-spacing:-.06em;margin:0 0 10px}.eyebrow{text-transform:uppercase;font-weight:750;letter-spacing:.13em;font-size:.69rem;color:#696b5f;margin:0 0 10px}.sub,.muted,small{color:var(--muted)}.sub{margin:0}.banner{border:1px solid #e9d8b5;background:#fff5df;border-radius:13px;padding:10px 14px;margin:0 0 14px;color:#624619;font-size:.84rem}.metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:0 0 12px}.metric,.panel{background:rgba(250,250,243,.86);border:1px solid rgba(255,255,255,.56);border-radius:24px}.metric{padding:16px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px;min-width:0;text-align:left}.metric strong{display:block;font-size:clamp(26px,3.4vw,48px);line-height:1;letter-spacing:-.06em;margin-top:8px}.metric-label{font-size:.85rem;font-weight:600}.dots{display:grid;grid-template-columns:repeat(7,6px);gap:4px}.dots i{width:6px;height:6px;border-radius:50%;background:#e9ebe4}.dots i.on{background:var(--tone)}.panel{padding:clamp(14px,2vw,25px);margin-bottom:12px}.section-top{margin-bottom:14px}.section-top h2{margin:0;font-size:clamp(19px,2.6vw,29px);letter-spacing:-.045em}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;text-align:left;min-width:650px}th,td{border-bottom:1px solid var(--line);padding:13px 10px 13px 0;vertical-align:middle}tr:last-child td{border-bottom:0}th{text-transform:uppercase;font-size:.69rem;letter-spacing:.07em;color:#555a50}td{font-size:.89rem}td small{display:block;margin-top:3px}.tag{display:inline-block;max-width:100%;background:#ecece1;border-radius:999px;padding:5px 9px;font-size:.73rem;white-space:nowrap}.tag.good{background:#dcefdc;color:#295a36}.tag.warn{background:#ffe4da;color:#8a352b}.tag.blue{background:#e0e8fb;color:#2f5098}.row-actions{display:flex;gap:6px;align-items:center}.row-actions .btn{padding:6px 10px;font-size:.75rem}.avatar{display:inline-grid;place-items:center;background:#f5e0b9;border-radius:50%;width:31px;height:31px;margin-right:7px;font-size:.72rem;font-weight:800;color:#715320}.empty{padding:22px 0;color:var(--muted);margin:0}.toolbar{justify-content:flex-start}.toolbar input,.toolbar select{width:auto}.split{display:grid;grid-template-columns:1fr 1fr;gap:12px}.statline{display:flex;gap:8px;flex-wrap:wrap}.timeline{list-style:none;padding:0;margin:0}.timeline li{padding:12px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.timeline li:last-child{border:0}.timeline p{margin:5px 0;white-space:pre-wrap}.timeline time{font-size:.75rem;color:var(--muted)}dialog{border:1px solid var(--line);border-radius:22px;width:min(680px,calc(100% - 24px));max-height:90vh;background:var(--paper);color:var(--ink);padding:22px;box-shadow:0 16px 80px #2426172b}dialog::backdrop{background:#22251e6c}dialog h2{margin:0;letter-spacing:-.04em}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{display:grid;gap:5px;font-size:.83rem;font-weight:650}.field.wide{grid-column:1/-1}input,textarea,select{min-width:0;width:100%;border:1px solid #cdcec1;background:#fffef8;border-radius:11px;padding:9px;color:var(--ink)}textarea{resize:vertical;min-height:65px}.form-actions{margin-top:14px;justify-content:flex-end}.form-error{color:#96352c;font-size:.85rem}.guide-item{padding:9px 0;border-bottom:1px solid var(--line);font-size:.9rem}.guide-item p{margin:4px 0}.guide-item small{display:block}details summary{cursor:pointer;font-weight:700;padding:10px 0}#notice{position:fixed;bottom:14px;right:14px;z-index:2;background:var(--ink);color:white;padding:10px 14px;border-radius:14px;max-width:calc(100% - 28px);font-size:.85rem}#notice:empty{display:none}.danger-text{color:#903425}.snapshot{line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}\n@media(max-width:1050px){.dots{display:none}}@media(max-width:700px){.top nav{order:3;width:100%;overflow:auto;flex-wrap:nowrap}.metrics{grid-template-columns:repeat(3,1fr)}.metric{padding:12px}.split{grid-template-columns:1fr}.panel{border-radius:18px}.form-grid{grid-template-columns:1fr}.top nav a{padding:8px 11px}}@media(max-width:360px){.metrics{grid-template-columns:repeat(2,1fr)}}\n\n/* Workflow controls use the existing QuidEdge palette. */\n:focus-visible{outline:3px solid #8f4b0c;outline-offset:3px}\n.skip{position:fixed;top:-100px;left:16px;z-index:10;background:#fff;padding:12px;border-radius:8px}\n.skip:focus{top:12px}\n.btn,.pill{min-height:42px}\n.top nav a{min-height:42px}\n.metric{display:block}\n.metric .metric-label{display:block}\n.metric-caption{display:block;font-size:.72rem;color:var(--muted);margin-top:10px}\n.filters{display:grid;grid-template-columns:2fr repeat(5,minmax(110px,1fr));gap:10px;margin-bottom:12px}\n.filters .field{font-size:.76rem}\n.result-count,.hint,.public-note{font-size:.8rem;color:var(--muted);line-height:1.5}\n.public-note{background:#f1f0e4;padding:10px 12px;border-radius:10px}\n.required{color:#8c3e15}\nfieldset{border:1px solid var(--line);border-radius:12px;padding:12px;margin:0;min-width:0}\nlegend{padding:0 6px;color:var(--muted);font-size:.8rem}\nfieldset:disabled{opacity:.5}\n[hidden]{display:none!important}\n.draft-banner{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px;background:#e6eddf;border-radius:14px;margin-bottom:14px;font-size:.85rem}\n.pagination{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}\n.checklist{list-style:none;padding:0}\n.checklist li{display:flex;gap:10px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding:9px 0;font-size:.85rem}\ndialog{overscroll-behavior:contain}\ndialog h2{max-width:calc(100% - 85px)}\n#app:focus{outline:none}\n@media(max-width:1100px){.filters{grid-template-columns:repeat(3,minmax(0,1fr))}}\n@media(max-width:700px){\n  .filters{grid-template-columns:repeat(2,minmax(0,1fr))}\n  .metrics{grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}\n  .metric{border-radius:14px;padding:12px 7px}\n  .metric-label{font-size:.68rem}\n  .metric strong{font-size:27px}\n  .metric-caption{display:none}\n  .scroll{overflow:visible}\n  table,thead,tbody,tr,td{display:block;min-width:0;width:100%}\n  thead{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}\n  tbody tr{padding:10px 0;border-bottom:1px solid var(--line)}\n  tbody tr:last-child{border:0}\n  td{display:flex;justify-content:space-between;gap:14px;align-items:center;border:0;padding:7px 0;flex-wrap:wrap;overflow-wrap:anywhere}\n  td::before{content:attr(data-label);color:var(--muted);font-size:.74rem;flex:0 0 95px}\n  td small{flex-basis:100%;text-align:right}\n  .row-actions{flex-wrap:wrap}\n  .form-grid .wide{grid-column:1/-1}\n  .top{gap:8px}\n  .top .pill{font-size:.72rem;padding:7px 10px}\n  .intro h1{font-size:34px}\n}\n@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}\n\n.coo-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.coo-stats .panel span{display:block;color:var(--muted);font-size:.84rem}.coo-stats strong{display:block;font-size:38px;margin-top:8px}.commission-lead{font-size:28px;font-weight:750;margin:4px 0}.commission-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.commission-grid>div{border:1px solid var(--line);border-radius:16px;padding:18px;background:#fff9ed}.commission-grid strong{display:block;font-size:34px}.commission-grid span{display:block;color:var(--muted);margin-top:6px}.benefit-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.benefit-grid h3{font-size:1rem}.role-list li{padding:7px 0;line-height:1.55}.panel p{line-height:1.6}.public-note{line-height:1.5}input[type=file]{font-size:.8rem}#upload-progress{font-size:.85rem;line-height:1.5}@media(max-width:850px){.coo-stats{grid-template-columns:repeat(2,1fr)}.benefit-grid{grid-template-columns:1fr 1fr}}@media(max-width:500px){.commission-grid,.benefit-grid{grid-template-columns:1fr}.commission-grid>div{padding:12px}.commission-grid strong{font-size:27px}.coo-stats strong{font-size:30px}}\n\n.split{grid-template-columns:repeat(2,minmax(0,1fr))}.split>*{min-width:0}@media(max-width:700px){.split{grid-template-columns:1fr}}\n\n/* Compact operations layout and task-focused forms. */\n.intro h1{font-size:clamp(30px,3.2vw,44px)}\n.panel{padding:18px 22px;border-radius:18px}.section-top{margin-bottom:10px}.section-top h2{font-size:23px}.empty{padding:10px 0}.metric{padding:12px 14px}.metric strong{font-size:34px}.metric-caption{margin-top:6px}\n.row-actions .btn{min-height:40px}.btn.danger{background:#fff5f2;border-color:#d9a398;color:#842c23}.btn.primary.danger{background:#a3392d;color:white;border-color:#a3392d}.btn.danger:hover{background:#f6e4df}.btn.primary.danger:hover{background:#8f2f25}\n.draft-banner small{display:block;color:#4c5647;margin-top:4px}.next-action-card{background:#f5e8cd;border:1px solid #e5c58e;padding:14px;border-radius:14px;margin:14px 0}.next-action-card .eyebrow{display:block}.next-action-card p{margin:5px 0 12px;line-height:1.5}.readiness-summary{border:1px solid var(--line);border-radius:14px;padding:14px}.readiness-summary p{margin:7px 0;line-height:1.5}.candidate-tools,.readiness-details,.history-section{border-bottom:1px solid var(--line);padding:7px 0}.tool-group{padding:8px 0 14px}.tool-group h3{font-size:.9rem;margin:8px 0}.danger-zone{border-top:1px solid var(--line)}.history-date{display:block;margin-top:5px}.record-details{display:grid;grid-template-columns:minmax(100px,1fr) 2fr;gap:8px;font-size:.85rem}.record-details dt{color:var(--muted)}.record-details dd{margin:0;overflow-wrap:anywhere}\n.form-section{border:1px solid var(--line);border-radius:12px;padding:0 12px}.form-section[open]{padding-bottom:12px}.form-section summary{font-size:.85rem}.form-section>.form-grid{margin-top:6px}#next-fields{grid-column:1/-1}.form-actions{position:sticky;bottom:-22px;background:var(--paper);border-top:1px solid var(--line);padding:12px 0 4px;z-index:1}.field input,.field select{min-height:44px}.public-note{font-size:.82rem}.candidate-tools .toolbar{gap:8px;align-items:stretch}dialog summary{min-height:44px}.readiness-summary .tag{white-space:normal}\n@media(max-width:700px){.panel{padding:15px}.record-details{grid-template-columns:1fr}.record-details dd{margin-bottom:8px}.candidate-tools .btn{white-space:normal;text-align:center}.next-action-card .btn{width:100%}.form-actions{bottom:-22px}.form-actions>.btn,.form-actions>button{flex:1;white-space:normal}.metric strong{font-size:27px}}\n\n.form-grid>.wide{grid-column:1/-1}\n", "type": "text/css; charset=utf-8" }, "/app.js": { "body": `// src/record-utils.js
var kinds = /* @__PURE__ */ new Set(["job", "candidate", "stage", "activity", "summary", "score"]);
var idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function validEvent(event) {
  return Boolean(event && typeof event === "object" && Number.isSafeInteger(event.seq) && event.seq > 0 && typeof event.id === "string" && idPattern.test(event.id) && kinds.has(event.kind) && (event.subject_id === null || typeof event.subject_id === "string" && idPattern.test(event.subject_id)) && typeof event.event_date === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(event.event_date) && event.payload && typeof event.payload === "object" && !Array.isArray(event.payload));
}
function validDraft(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && ["job", "candidate", "stage", "activity", "score", "checklist", "commission", "summary", "correction", "recordaction"].includes(value.kind) && typeof value.id === "string" && (!value.id || idPattern.test(value.id)) && typeof value.request === "string" && idPattern.test(value.request) && Number.isSafeInteger(value.revision) && value.revision >= 0 && value.values && typeof value.values === "object" && !Array.isArray(value.values) && Object.values(value.values).every((v) => typeof v === "string") && (value.kind !== "score" || ["R1", "R2"].includes(value.values.round)) && (!value.pending || typeof value.pending === "object" && value.pending.id === value.request && kinds.has(value.pending.kind)));
}
function foldCalendarLine(line) {
  const encoder = new TextEncoder();
  const lines = [];
  let current = "", size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > 75) {
      lines.push(current);
      current = " ";
      size = 1;
    }
    current += char;
    size += bytes;
  }
  lines.push(current);
  return lines.join("\\r\\n");
}
function mergeDrafts(drafts, value, kind = value?.kind, id = value?.id) {
  const remaining = drafts.filter((d) => d.kind !== kind || d.id !== id);
  return value ? [...remaining, value] : remaining;
}

// src/guide.js?v=5ea8864332e1
var guide_default = [["R1", "Open", 2, "Explain the role, call structure and next round.", null], ["R1", "Experience", 2, "Walk me through your last two roles. For each, what did you personally own on social media, and who else was on the team?", null], ["R1", "Experience", 3, "Pick the campaign you are most proud of. What was the goal, what did you personally do, and what was the result?", null], ["R1", "Experience", 1, "How many of your clients or audiences were outside Sri Lanka, and in which countries?", null], ["R1", "English and client communication", 4, "Live reply. \\u201CThis is Sarah from Bloom Skincare in the UK. Honestly, I\\u2019m disappointed. We have paid for 2 months and our Instagram engagement has dropped. My friend\\u2019s brand posts every day and gets far more likes. I want us posting daily starting tomorrow.\\u201D", "Listen for acknowledgement, clarifying questions and a concrete next step."], ["R1", "English and client communication", 3, "Tell me about a client who was genuinely unhappy with your work. What were the first words you said to them, and how did it end?", null], ["R1", "AI use", 2, "Which AI tools do you use in your work, and what exactly do you use each one for?", null], ["R1", "AI use", 2, "Tell me about the last time AI gave you something you could not use. What was wrong with it, and what did you do?", null], ["R1", "AI use", 1, "If a post created with AI help causes a problem for the client, whose responsibility is it?", null], ["R1", "Confidentiality and NDA", 2, "In your own words, what does an NDA actually cover, and when does it stop applying?", "Listen for checking the specific agreement and its terms."], ["R1", "Confidentiality and NDA", 2, "A prospect asks, \\u201CWhich other brands do you work with? Can you show me what you did for them?\\u201D What do you say?", null], ["R1", "Logistics", 4, "Confirm notice period, earliest start, salary expectation range, hours and time zone flexibility, internet, backup power, quiet call space and ongoing commitments.", "For commission-based openings, confirm the approved terms and candidate understanding."], ["R1", "Questions and close", 2, "Take candidate questions and confirm when they\\u2019ll hear back.", "R1 total is 30 minutes."], ["R2", "Open", 3, "Explain the hour and confirm the later writing task is without AI.", "Writing task is tracked separately."], ["R2", "Brand audit presentation", 10, "Candidate presents six slides without interruption.", null], ["R2", "Audit defence", 2, "Why did you choose these three weaknesses over everything else you saw?", null], ["R2", "Audit defence", 2, "What did AI suggest that you rejected, and why did you reject it?", null], ["R2", "Audit defence", 2, "The client says there is no budget for your creative idea. What is your plan B?", null], ["R2", "Audit defence", 2, "If you could do only one of your three improvements first, which one, and what would you measure?", null], ["R2", "Audit defence", 2, "Follow-up and note-taking buffer.", "Fills the 10-minute block."], ["R2", "Client role-play", 2, "\\u201CWe sell handmade candles in Australia. We need to go viral. Can you guarantee that?\\u201D", null], ["R2", "Client role-play", 2, "\\u201COur sales have been flat, so we just want more followers.\\u201D", null], ["R2", "Client role-play", 2, "\\u201CWe want it to feel more premium, but not too serious.\\u201D", null], ["R2", "Client role-play", 2, "\\u201CI heard you work with [a competitor]. What is their ad budget?\\u201D", "Confidentiality check."], ["R2", "Client role-play", 2, "Interrupt mid-sentence with a new concern.", null], ["R2", "Client role-play", 3, "\\u201CHonestly, what do you think is wrong with our brand right now?\\u201D", null], ["R2", "Client role-play", 7, "Role-play buffer and follow-up.", "Includes the original 2-minute buffer and 5 unallocated minutes."], ["R2", "Team behaviours", 10, "Pick four from the question bank below.", null], ["R2", "Their questions", 5, "Take candidate questions.", null], ["R2", "Close and next steps", 2, "Confirm reference contacts and decision timeline.", "R2 total is 60 minutes."], ["Bank", "Team behaviours", null, "Describe the best manager you have worked with. What made it work?", null], ["Bank", "Team behaviours", null, "Tell me about the harshest feedback you have received, and what you did with it.", null], ["Bank", "Team behaviours", null, "You finish your tasks early on a quiet day. What do you do?", null], ["Bank", "Team behaviours", null, "A teammate is struggling with a client and it is not your account. What do you do?", null], ["Bank", "Team behaviours", null, "Why a small, growing company rather than a large agency?", null], ["Bank", "Team behaviours", null, "What does \\u201Cbeing responsible for your work\\u201D mean to you?", null], ["Scoring", "Evidence", null, "1 = clear gap. 2 = partial. 3 = meets the requirement. 4 = strong. 5 = consistently strong evidence. Leave untested criteria blank.", "Use the same core prompts and criteria for everyone in the same role."], ["Setup", "Before outreach", null, "Confirm the open role, approved terms and interview criteria with leadership. Explain approved commission terms early when applicable.", "If hiring Client Acquisition & Client Relations, adapt the social media audit to a role-relevant exercise before using it."], ["Workflow", "Stage updates", null, "After each round, save the scorecard and recommendation. Set the candidate\\u2019s stage, next action, owner and due date. Log the event.", "Keep candidate contact details and scorecards in the shared hiring file with restricted access."], ["Workflow", "Final decision", null, "Record the decision and reason. Track references, candidate communication and agreement/NDA milestones as applicable.", "Record who approved any exception in the candidate note."]];

// src/model.js?v=5ea8864332e1
var stages = ["Sourced", "Contacted", "Replied", "R1 Scheduled", "R1 Review", "R2 Prep", "R2 Scheduled", "R2 Review", "Reference Check", "Offer / Agreement", "On Hold", "Hired", "Rejected", "Withdrawn"];
var closed = ["Hired", "Rejected", "Withdrawn"];
var milestones = ["First outreach", "Reply received", "Follow-up sent", "R1 completed", "R2 brief sent", "R2 completed", "Writing task completed", "References completed", "Offer sent", "Agreement / NDA signed", "Interview no-show", "Interview cancelled", "Offer declined", "Blocker update", "Commission terms reviewed", "Candidate details corrected", "Document availability checked"];
var checklistItems = [
  ["terms", "Role and payment terms confirmed"],
  ["writing", "Writing / practical task reviewed"],
  ["references", "References checked"],
  ["offer", "Offer accepted"],
  ["agreement", "Agreement completed"],
  ["nda", "NDA completed"]
];
var dateSL = (date = /* @__PURE__ */ new Date()) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Colombo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(date);
var groupStages = [
  ["Sourced", ["Sourced", "Contacted", "Replied"], "amber"],
  ["Screening", ["R1 Scheduled", "R1 Review"], "blue"],
  ["Technical", ["R2 Prep", "R2 Scheduled", "R2 Review", "Reference Check"], "coral"],
  ["Offer", ["Offer / Agreement"], "purple"],
  ["Hired", ["Hired"], "green"]
];
var escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
})[c]);
function validDate(value) {
  if (typeof value !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const parsed = /* @__PURE__ */ new Date(value + "T00:00:00Z");
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value;
}
function stageProblem(payload, candidate, eventDate) {
  if (candidate.job_id === "e2173dde-bc77-409a-96a1-86dcb23841f0" && ["R1 Scheduled", "R1 Review", "R2 Prep", "R2 Scheduled", "R2 Review", "Reference Check", "Offer / Agreement", "Hired"].includes(payload.stage) && (candidate.commission_ack !== "Accepted" || !candidate.terms_detail?.trim())) return "Confirm accepted commission-only terms before advancing this candidate.";
  if (!stages.includes(payload.stage)) return "Choose a valid stage.";
  if (!String(payload.note || "").trim()) return "Add the reason for this update.";
  if (!closed.includes(payload.stage)) {
    if (![payload.action, payload.due, payload.owner].every((v) => typeof v === "string" && v.trim())) return "Set the next action, owner and due date.";
  }
  const slot = payload.stage === "R1 Scheduled" ? payload.r1 : payload.stage === "R2 Scheduled" ? payload.r2 : "";
  if (["R1 Scheduled", "R2 Scheduled"].includes(payload.stage)) {
    if (!slot) return "Set the interview date and time in Sri Lanka time.";
    if (slot.slice(0, 10) < eventDate) return "The interview cannot be earlier than the event date.";
  }
  if (payload.stage === "Hired") {
    const missing = checklistItems.filter(([key]) => !["Complete", "Waived"].includes(candidate.checklist[key]));
    if (missing.length) return "Complete or waive each hiring checklist item before marking Hired.";
    if (!validDate(payload.start_date)) return "Confirm the start date before marking Hired.";
  }
  return "";
}
function recordStates(events2) {
  const states = /* @__PURE__ */ new Map();
  for (const event of [...events2].sort((a, b) => a.seq - b.seq)) {
    if (event.kind === "summary" && event.payload.operation && event.payload.target_id)
      states.set(event.payload.target_id, { deleted: event.payload.operation === "delete", revision: event.seq });
  }
  return states;
}
function visibleEvents(events2) {
  const states = recordStates(events2);
  const replaced = new Set(events2.filter((e) => e.payload.supersedes).map((e) => e.payload.supersedes));
  return events2.filter((e) => !e.payload.operation && !states.get(e.id)?.deleted && !replaced.has(e.id));
}
function project(events2) {
  const states = recordStates(events2);
  const visible = new Set(visibleEvents(events2).map((e) => e.id));
  const jobs = /* @__PURE__ */ new Map();
  const candidates = /* @__PURE__ */ new Map();
  for (const event of [...events2].sort((a, b) => a.seq - b.seq)) {
    const p = event.payload;
    if (p.operation) continue;
    if (!visible.has(event.id) && !(event.kind === "candidate" || event.kind === "job" && !p.job_id)) continue;
    if (p.supersedes && !visible.has(event.id)) continue;
    if (event.kind === "job") {
      if (p.job_id) {
        const job = jobs.get(p.job_id);
        if (job) Object.assign(job, p, { id: p.job_id, revision: event.seq });
      } else {
        jobs.set(event.id, { status: "Open", headcount: "1", ...p, id: event.id, revision: event.seq });
      }
    }
    if (event.kind === "candidate") {
      candidates.set(event.id, {
        ...p,
        id: event.id,
        date: event.event_date,
        revision: event.seq,
        history: [event],
        r1: "",
        r2: "",
        checklist: {},
        documents: { cv: "Missing", cover: "Missing" },
        start_date: ""
      });
    }
    const candidate = candidates.get(event.subject_id);
    if (!candidate) continue;
    candidate.history.push(event);
    candidate.revision = event.seq;
    if (event.kind === "stage") {
      for (const key of ["stage", "action", "due", "owner", "blocker", "r1", "r2", "start_date"]) {
        if (key in p) candidate[key] = p[key];
      }
    }
    if (event.kind === "activity") {
      if (p.event === "Candidate details corrected") {
        for (const key of ["alias", "source", "availability", "notice", "market"]) if (key in p) candidate[key] = p[key];
      }
      if (p.event === "Document availability checked") {
        candidate.documents_checked_at = event.created_at;
        for (const type of ["cv", "cover"]) if (p[type + "_state"]) candidate.documents[type] = p[type + "_state"];
      }
      if (p.event === "Document stored" && ["cv", "cover"].includes(p.document_type)) candidate.documents[p.document_type] = "Receipt saved";
      if (p.event === "Commission terms reviewed") {
        candidate.commission_ack = p.commission_ack;
        candidate.commission_plan = p.commission_plan;
        candidate.terms_detail = p.terms_detail || "";
      }
      if (p.event === "Hiring checklist updated") {
        for (const [key] of checklistItems) {
          if (key in p) candidate.checklist[key] = p[key];
        }
      }
      const completed = {
        "Writing task completed": ["writing"],
        "References completed": ["references"],
        "Agreement / NDA signed": ["agreement", "nda"]
      }[p.event] || [];
      for (const key of completed) candidate.checklist[key] = "Complete";
    }
  }
  for (const job of jobs.values()) job.deleted = Boolean(states.get(job.id)?.deleted);
  for (const candidate of candidates.values()) candidate.deleted = Boolean(states.get(candidate.id)?.deleted);
  for (const event of events2) {
    const revision = states.get(event.id)?.revision;
    if (!revision) continue;
    const candidate = candidates.get(event.subject_id || event.id);
    const job = jobs.get(event.payload.job_id || event.id);
    if (candidate) candidate.revision = Math.max(candidate.revision, revision);
    if (job) job.revision = Math.max(job.revision, revision);
  }
  return { jobs: [...jobs.values()].reverse(), candidates: [...candidates.values()].reverse() };
}
function attention(candidate, today = dateSL()) {
  if (closed.includes(candidate.stage)) return "Closed";
  if (candidate.due && candidate.due < today) return "Overdue";
  if (candidate.blocker || candidate.owner === "Leadership") return "Needs decision";
  if (!candidate.action || !candidate.due || !candidate.owner) return "Missing next step";
  return candidate.due === today ? "Due today" : "On track";
}
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}
var roleScorecards = {
  acquisition: { R1: ["Acquisition evidence", "Client communication", "Commercial judgment", "Confidentiality & terms"], R2: ["Prospect research", "Discovery & proposals", "Objection handling", "Client relations & follow-up"] },
  social: { R1: ["Campaign ownership & results", "English & client communication", "AI judgment", "Confidentiality"], R2: ["Brand audit evidence", "Creative strategy", "Client role-play", "Team responsibility"] }
};
function scorecardFor(job) {
  return roleScorecards[job?.profile === "client-acquisition-v1" ? "acquisition" : "social"];
}
function interviewRevision(events2, candidate) {
  const stages2 = new Set(events2.filter((e) => e.kind === "stage" && e.subject_id === candidate.id).map((e) => e.id));
  return events2.reduce((seq, e) => stages2.has(e.id) || e.kind === "summary" && ["delete", "restore"].includes(e.payload.operation) && (e.payload.target_id === candidate.id || stages2.has(e.payload.target_id)) ? Math.max(seq, e.seq) : seq, 0);
}

// src/role.js
var hiringRole = {
  id: "e2173dde-bc77-409a-96a1-86dcb23841f0",
  title: "Client Acquisition & Client Relations Specialist",
  company: "QuidEdge",
  location: "Remote | Work From Anywhere",
  employment: "Independent Contractor | Commission-Based only",
  industry: "Personal Branding | Business Branding | Content Creation",
  compensation: "100% commission-based. No fixed salary. 10%, 20% or 30% recurring monthly commission on eligible acquired client contracts, subject to the agreed terms.",
  important: "Only candidates genuinely comfortable with a commission-only compensation structure should apply. Candidates must understand and accept the agreed terms before progressing.",
  about: [
    "At QuidEdge, we believe great brands are built through meaningful relationships, creative thinking, and strategies that deliver real business value.",
    "We are a dedicated team of professionals specialising in personal branding, business branding, content creation, social media management, and business development consulting.",
    "We work with founders, entrepreneurs, creators, and businesses to help them strengthen their market presence, communicate their value, and build brands that people genuinely connect with.",
    "We are not interested in simply selling services. We believe in understanding businesses, solving real problems, and building long-term partnerships.",
    "As we continue expanding internationally, we are looking for passionate and ambitious individuals to join our team as Client Acquisition & Client Relations Specialists."
  ],
  overview: [
    "This is not a traditional sales position. Successful client acquisition starts with trust, genuine conversations, and understanding what a business actually needs.",
    "Identify potential clients, build professional relationships, introduce QuidEdge\\u2019s solutions, and guide prospects through the acquisition process.",
    "Maintain strong client relationships and ensure a positive experience throughout their journey with us."
  ],
  responsibilities: [
    "Identify and research potential clients, including founders, entrepreneurs, creators, and business decision-makers.",
    "Connect with qualified prospects through LinkedIn, email, professional networks, and other appropriate outreach channels.",
    "Build genuine relationships instead of relying on generic or aggressive sales pitches.",
    "Understand prospective clients\\u2019 business challenges, branding needs, goals, and growth opportunities.",
    "Present QuidEdge\\u2019s services professionally and communicate how our team can deliver value.",
    "Conduct discovery conversations, handle enquiries, and coordinate proposals with our internal team.",
    "Manage the client acquisition journey from initial outreach to successful agreement.",
    "Maintain accurate records of prospect communications, follow-ups, and client interactions.",
    "Build and maintain positive, long-term relationships with acquired clients.",
    "Collaborate with our leadership, creative, and operations teams to ensure smooth client onboarding and communication.",
    "Represent QuidEdge with professionalism, integrity, and confidentiality."
  ],
  benefits: [
    ["Work From Anywhere", "Enjoy the flexibility of working remotely while connecting with businesses and professionals internationally."],
    ["Build Long-Term Income Opportunities", "Develop a portfolio of clients that can generate recurring commissions rather than relying solely on one-time sales."],
    ["A Supportive Team Culture", "People should feel valued, respected, and supported. Collaboration, open communication, and continuous development are central to how we work."],
    ["Professional Growth", "Gain practical exposure to international business development, client negotiations, brand strategy, and relationship management."],
    ["Your Ideas Matter", "We encourage initiative and fresh perspectives. Contribute to improving our client acquisition strategies and growing as a team."]
  ],
  tiers: [["10%", "AUD 300\\u20131,000 / month"], ["20%", "AUD 1,000\\u20134,999 / month"], ["30%", "AUD 5,000+ / month"]],
  payment: "Commission is uncapped and continues monthly while the client stays active and paying. Paid monthly in AUD after QuidEdge receives the client\\u2019s payment, subject to the agreed contract.",
  boundary: "The supplied tier ranges overlap at AUD 1,000. Confirm the applicable rate in the candidate\\u2019s agreement; this dashboard does not calculate or promise a rate at that boundary.",
  screening: [
    ["Experience", "Walk through your last two roles. What outreach, discovery, closing and ongoing client relationship work did you personally own?"],
    ["Evidence", "Describe a client you acquired. How did you identify them, qualify the need, build trust and reach an agreement? What was the commercial result?"],
    ["International communication", "Which client markets have you worked with? Respond live to a prospect who asks for a guarantee of sales or viral results."],
    ["Commission understanding", "Explain the commission-only arrangement in your own words. Is there a fixed salary? When are commissions paid? What terms must you confirm?"],
    ["Client relations", "Tell us about an unhappy client. What did you say first, how did you handle it and what changed?"],
    ["Confidentiality", "A prospect asks for a competitor\\u2019s budget and private results. How would you respond?"],
    ["AI judgment", "Which tools support your research and outreach? Give an example you rejected or verified before using."],
    ["Remote readiness", "Confirm working hours, market time zones, notice period, internet, backup power, call space and other commitments."]
  ]
};
function defaultRoleRecord(date) {
  return { id: hiringRole.id, kind: "job", subject_id: null, event_date: date, payload: {
    title: hiringRole.title,
    department: "Client Services",
    location: "Remote \\xB7 International",
    employment: "Commission-based",
    headcount: "1",
    status: "Open",
    profile: "client-acquisition-v1",
    brief: "Independent contractor. No fixed salary. 10% / 20% / 30% recurring commission on eligible acquired contracts under agreed terms. Own prospect research, outreach, discovery, proposals, closing, onboarding and ongoing client relations. Confirm terms and international communication readiness."
  } };
}

// node_modules/fflate/esm/browser.js
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  1,
  1,
  1,
  2,
  2,
  2,
  2,
  3,
  3,
  3,
  3,
  4,
  4,
  4,
  4,
  5,
  5,
  5,
  5,
  0,
  /* unused */
  0,
  0,
  /* impossible */
  0
]);
var fdeb = new u8([
  0,
  0,
  0,
  0,
  1,
  1,
  2,
  2,
  3,
  3,
  4,
  4,
  5,
  5,
  6,
  6,
  7,
  7,
  8,
  8,
  9,
  9,
  10,
  10,
  11,
  11,
  12,
  12,
  13,
  13,
  /* unused */
  0,
  0
]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i2 = 0; i2 < 31; ++i2) {
    b[i2] = start += 1 << eb[i2 - 1];
  }
  var r = new i32(b[30]);
  for (var i2 = 1; i2 < 30; ++i2) {
    for (var j = b[i2]; j < b[i2 + 1]; ++j) {
      r[j] = j - b[i2] << 5 | i2;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0; i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = (function(cd, mb, r) {
  var s = cd.length;
  var i2 = 0;
  var l = new u16(mb);
  for (; i2 < s; ++i2) {
    if (cd[i2])
      ++l[cd[i2] - 1];
  }
  var le = new u16(mb);
  for (i2 = 1; i2 < mb; ++i2) {
    le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        var sv = i2 << 4 | cd[i2];
        var r_1 = mb - cd[i2];
        var v = le[cd[i2] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1; v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i2 = 0; i2 < s; ++i2) {
      if (cd[i2]) {
        co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
      }
    }
  }
  return co;
});
var flt = new u8(288);
for (i = 0; i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144; i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256; i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280; i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0; i < 32; ++i)
  fdt[i] = 5;
var i;
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i2 = 1; i2 < a.length; ++i2) {
    if (a[i2] > m)
      m = a[i2];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
  // determined by unknown compression method
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i2 = 0; i2 < hcLen; ++i2) {
          clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i2 = 0; i2 < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i2++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i2 - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i2++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (; ; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i2 = sym - 257, b = fleb[i2];
          add = bits(dat, pos, (1 << b) - 1) + fl[i2];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (; bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (; bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var et = /* @__PURE__ */ new u8(0);
var b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
};
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {
}
var dutf8 = function(d) {
  for (var r = "", i2 = 0; ; ) {
    var c = d[i2++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i2 + eb > d.length)
      return { s: r, r: slc(d, i2 - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i2++] & 63) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i2++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63);
  }
};
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i2 = 0; i2 < dat.length; i2 += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i2, i2 + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var slzh = function(d, b) {
  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
  var fnl = b2(d, b + 28), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl, bs = b4(d, b + 20);
  var _a2 = z && bs == 4294967295 ? z64e(d, es) : [bs, b4(d, b + 24), b4(d, b + 42)], sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d, b + 10), sc, su, fn, es + b2(d, b + 30) + b2(d, b + 32), off];
};
var z64e = function(d, b) {
  for (; b2(d, b) != 1; b += 4 + b2(d, b + 2))
    ;
  return [b8(d, b + 12), b8(d, b + 4), b8(d, b + 20)];
};
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (; b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  ;
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = o == 4294967295 || c == 65535;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i2 = 0; i2 < c; ++i2) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}

// src/binary.js
function validateDocumentBytes(bytes, extension) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 5 * 1024 * 1024) throw Error("Each document must be 1 byte to 5 MB.");
  if (extension === "pdf") {
    const header = new TextDecoder().decode(bytes.slice(0, 16)), tail = new TextDecoder().decode(bytes.slice(-2048));
    if (!/^%PDF-\\d\\.\\d/.test(header) || !tail.includes("%%EOF") || bytes.length < 40) throw Error("This is not a complete PDF document. Export it again and retry.");
    return;
  }
  if (extension === "doc") {
    const magic = [208, 207, 17, 224, 161, 177, 26, 225];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    if (bytes.length < 1024 || !magic.every((b, i2) => bytes[i2] === b) || view.getUint16(28, true) !== 65534 || ![9, 12].includes(view.getUint16(30, true)) || !new TextDecoder("utf-16le").decode(bytes).includes("WordDocument")) throw Error("This is not a supported Word DOC file. Export it as DOCX or PDF.");
    return;
  }
  if (extension !== "docx") throw Error("Use PDF, DOC or DOCX.");
  let count = 0, total = 0, macro = false, files;
  try {
    files = unzipSync(bytes, { filter: (file) => {
      if (++count > 2048 || (total += file.originalSize) > 32 * 1024 * 1024 || file.originalSize > 16 * 1024 * 1024) throw Error("Oversized archive");
      if (/vbaproject|activex|\\.\\.\\//i.test(file.name)) macro = true;
      return ["[Content_Types].xml", "word/document.xml", "_rels/.rels"].includes(file.name);
    } });
  } catch {
    throw Error("The DOCX archive is damaged or too large when expanded.");
  }
  if (macro || !files["[Content_Types].xml"] || !files["word/document.xml"] || !files["_rels/.rels"] || !strFromU8(files["[Content_Types].xml"]).includes("wordprocessingml.document.main+xml") || !/wordprocessingml\\/2006\\/main|ooxml.org\\/wordprocessingml\\/main/.test(strFromU8(files["word/document.xml"]))) throw Error("The file is not a standard DOCX document. Export it again as DOCX or PDF.");
}

// src/documents.js
var maxDocumentBytes = 5 * 1024 * 1024;
async function checkDocument(file) {
  if (!file || !file.size) throw new Error("Choose a non-empty document.");
  if (file.size > maxDocumentBytes) throw new Error("Each document must be 5 MB or smaller.");
  const ext = file.name.split(".").at(-1).toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateDocumentBytes(bytes, ext);
  const pdf = ext === "pdf", doc = ext === "doc";
  return { extension: ext, mime: pdf ? "application/pdf" : doc ? "application/msword" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
}
async function uploadDocument(apiBase2, candidate, fullName, file, type, requestId) {
  const metadata = await checkDocument(file);
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i2 = 0; i2 < buffer.length; i2 += 32768) binary += String.fromCharCode(...buffer.subarray(i2, i2 + 32768));
  let response;
  try {
    response = await fetch(apiBase2 + "/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: requestId,
        candidate_id: candidate.id,
        name: fullName,
        document_type: type,
        extension: metadata.extension,
        data: btoa(binary)
      }),
      signal: AbortSignal.timeout(9e4)
    });
  } catch {
    throw new Error("Upload interrupted. Retry with the same file. The candidate record is already saved.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || "Document upload failed. Retry with the same file.");
  if (result?.uploaded !== true || !validEvent(result.event) || result.event.id !== requestId || result.event.subject_id !== candidate.id || result.event.kind !== "activity" || result.event.payload.event !== "Document stored" || result.event.payload.document_type !== type) {
    throw new Error("Drive did not confirm the saved document. Keep the file selected and retry.");
  }
  return result;
}

// src/config.js?v=5ea8864332e1
var config = { eventsUrl: "/api/events" };

// src/store.js?v=5ea8864332e1
var apiBase = config.eventsUrl.replace(/\\/events$/, "");
var connected = Boolean(config.eventsUrl);
async function request(path = "", options2 = {}) {
  let response;
  try {
    response = await fetch(config.eventsUrl + path, {
      cache: "no-store",
      signal: AbortSignal.timeout(2e4),
      ...options2
    });
  } catch {
    throw new Error("Connection interrupted. Your draft is kept. Retry to confirm the same save.");
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("The server response could not be confirmed. Your draft is kept; retry the same save.");
  }
  if (!response.ok) {
    const error = new Error(body?.error || "Storage request failed. Try again.");
    error.status = response.status;
    throw error;
  }
  return body;
}
async function loadEvents(after = 0, filters = {}) {
  const events2 = [];
  let cursor = after;
  for (; ; ) {
    const batch = await request("?" + new URLSearchParams({ ...filters, after: String(cursor) }));
    if (!Array.isArray(batch)) throw new Error("The server returned an invalid event list.");
    if (!batch.length) return events2;
    let previous = cursor;
    const ids = /* @__PURE__ */ new Set();
    if (batch.some((event) => {
      if (!validEvent(event) || event.seq <= previous || ids.has(event.id)) return true;
      previous = event.seq;
      ids.add(event.id);
      return false;
    })) {
      throw new Error("The event cursor is invalid. Refresh to retry.");
    }
    events2.push(...batch);
    cursor = batch.at(-1).seq;
    if (batch.length < 500) return events2;
  }
}
async function append(event) {
  const saved = await request("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event)
  });
  if (!validEvent(saved) || saved.id !== event.id || saved.kind !== event.kind || saved.subject_id !== event.subject_id) {
    throw new Error("The saved record was not confirmed. Your draft is kept; retry the same save.");
  }
  return saved;
}
function createEventReader() {
  let cursor = 0, started = false;
  return async () => {
    if (!started) {
      const response = await fetch(apiBase + "/bootstrap", { cache: "no-store", signal: AbortSignal.timeout(2e4) });
      if (!response.ok) {
        const events2 = await loadEvents(0);
        cursor = events2.at(-1)?.seq || 0;
        started = true;
        return events2;
      }
      const snapshot = await response.json();
      if (!Number.isSafeInteger(snapshot.cursor) || snapshot.cursor < 0 || !Array.isArray(snapshot.events) || snapshot.events.some((e) => !validEvent(e) || e.seq > snapshot.cursor)) throw Error("Invalid recruitment snapshot. Retry sync.");
      cursor = snapshot.cursor;
      started = true;
      return snapshot.events;
    }
    const incoming = await loadEvents(cursor);
    if (incoming.length) cursor = incoming.at(-1).seq;
    return incoming;
  };
}

// src/app.js
var readUpdates = createEventReader();
var app = document.querySelector("#app");
var dialog = document.querySelector("#dialog");
var mode = document.querySelector("#mode");
var sync = document.querySelector("#sync");
var notice = document.querySelector("#notice");
var owners = ["COO", "Leadership", "Candidate"];
var sources = ["Headhunting", "Referral", "Inbound", "Other"];
var employmentTypes = ["Contract", "Full-time", "Part-time", "Commission-based"];
var pageSize = 25;
var events = [];
var state = { jobs: [], candidates: [] };
var jobNames = /* @__PURE__ */ new Map();
var candidateIndex = /* @__PURE__ */ new Map();
var ready = false;
var failure = "";
var refreshing = false;
var saving = false;
var timer;
var focusReturn;
var pendingRecord = null;
var lastDay = dateSL();
var reportDate = lastDay;
var stageFilter = "";
var jobFilter = "";
var attentionFilter = "";
var ownerFilter = "";
var search = "";
var sort = "recent";
var currentPage = 1;
var guideTrack = "Client Acquisition & Relations";
var searchTimer;
var noticeTimer;
var page = () => ["overview", "coo", "role", "pipeline", "activity", "interviews", "guide", "trash"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";
var btn = (label, action, id = "", primary = false) => '<button type="button" class="btn ' + (primary ? "primary" : "") + '" data-action="' + escape(action) + '" data-id="' + escape(id) + '">' + escape(label) + "</button>";
var dangerBtn = (label, action, id) => btn(label, action, id).replace('class="btn ', 'class="btn danger ');
var tag = (text, type = "") => '<span class="tag ' + type + '">' + escape(text) + "</span>";
var empty = (text) => '<p class="empty">' + escape(text) + "</p>";
function options(values, selected = "") {
  return values.map((item) => {
    const [value, label] = Array.isArray(item) ? item : [item, item];
    return '<option value="' + escape(value) + '"' + (String(value) === String(selected) ? " selected" : "") + ">" + escape(label) + "</option>";
  }).join("");
}
function table(head, rows) {
  return '<div class="scroll"><table><thead><tr>' + head.map((h) => '<th scope="col">' + escape(h) + "</th>").join("") + "</tr></thead><tbody>" + rows.map((row) => "<tr>" + row.map((cell, i2) => '<td data-label="' + escape(head[i2]) + '">' + cell + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
}
var panel = (title, html, action = "") => '<section class="panel"><div class="section-top"><h2>' + escape(title) + "</h2>" + action + "</div>" + html + "</section>";
var heading = (title, subtitle, action = "") => '<div class="intro"><div><p class="eyebrow">QuidEdge / Operations</p><h1>' + escape(title) + '</h1><p class="sub">' + escape(subtitle) + "</p></div>" + action + "</div>";
var eventLabel = (event) => ({
  job: event.payload.job_id ? "Position updated" : "Position opened",
  candidate: "Candidate sourced",
  stage: event.payload.stage,
  activity: event.payload.event,
  summary: "Daily summary",
  score: event.payload.round + " scorecard"
})[event.kind];
var jobTitle = (id) => jobNames.get(id) || "Position unavailable";
var candidateById = (id) => candidateIndex.get(id);
function storageDrafts() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("qe-recruitment-draft") || "null");
    return (Array.isArray(saved) ? saved : [saved]).filter(validDraft);
  } catch {
    return [];
  }
}
function storageRead(kind, id) {
  return storageDrafts().find((d) => !kind || d.kind === kind && d.id === id) || null;
}
function storageWrite(value, kind, id) {
  try {
    const drafts = mergeDrafts(storageDrafts(), value, kind, id);
    if (drafts.length) sessionStorage.setItem("qe-recruitment-draft", JSON.stringify(drafts));
    else sessionStorage.removeItem("qe-recruitment-draft");
  } catch {
    flash("Browser draft storage is unavailable. Keep this tab open until the server confirms your save.");
  }
}
function ingest(incoming) {
  if (!incoming.length) return false;
  const known = new Set(events.map((event) => event.id));
  const fresh = incoming.filter((event) => !known.has(event.id));
  if (!fresh.length) return false;
  events = events.concat(fresh).sort((a, b) => a.seq - b.seq);
  state = project(events);
  state.jobs = state.jobs.filter((j) => !j.deleted);
  state.candidates = state.candidates.filter((c) => !c.deleted);
  jobNames = new Map(project(events).jobs.map((job) => [job.id, job.title]));
  candidateIndex = new Map(state.candidates.map((candidate) => [candidate.id, candidate]));
  return true;
}
function candidateTable(candidates, action = "stage", label = "Update stage") {
  if (candidates.length > 25) return candidateTable(candidates.slice(0, 25), action, label) + '<p class="hint">Showing 25 of ' + candidates.length + " candidates. Use Pipeline for all records and filters.</p>";
  if (!candidates.length) return empty("No candidates in this view. Add a candidate or adjust the filters.");
  return table(["Candidate", "Position", "Stage", "Next action", "Attention", "Actions"], candidates.map((candidate) => {
    const flag = attention(candidate);
    return [
      "<strong>" + escape(candidate.alias) + "</strong><small>" + escape(candidate.source) + "</small><small>CV (last receipt/check): " + escape(candidate.documents?.cv || "Missing") + " \\xB7 Cover letter: " + escape(candidate.documents?.cover || "Missing") + "</small>",
      escape(jobTitle(candidate.job_id)),
      tag(candidate.stage, candidate.stage === "Hired" ? "good" : "blue"),
      closed.includes(candidate.stage) ? escape(candidate.stage === "Hired" ? "Hiring completed" : "Process closed") + (candidate.start_date ? "<small>Start date \\xB7 " + escape(candidate.start_date) + "</small>" : "") : escape(candidate.action || "Set the next step") + "<small>" + escape(candidate.due || "No due date") + " \\xB7 " + escape(candidate.owner || "No owner") + "</small>",
      tag(flag, ["Overdue", "Needs decision", "Missing next step"].includes(flag) ? "warn" : ""),
      '<div class="row-actions">' + btn("View record", "view", candidate.id) + (closed.includes(candidate.stage) ? "" : btn(label, action, candidate.id, true)) + dangerBtn("Move to Trash", "delete-record", candidate.id) + "</div>"
    ];
  }));
}
function overview() {
  const candidates = state.candidates;
  const openJobs = state.jobs.filter((job) => job.status === "Open");
  const metrics = groupStages.map(([label, values, tone]) => {
    const count = candidates.filter((candidate) => values.includes(candidate.stage)).length;
    return '<button class="metric" type="button" data-action="group" data-id="' + escape(label) + '" style="--tone:var(--' + tone + ')"><span class="metric-label">' + escape(label) + "</span><strong>" + count + '</strong><span class="metric-caption">View candidates</span></button>';
  }).join("");
  const active = candidates.filter((candidate) => !closed.includes(candidate.stage));
  const queue = active.filter((candidate) => attention(candidate) !== "On track").sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const jobRows = state.jobs.map((job) => [
    "<strong>" + escape(job.title) + "</strong><small>" + escape(job.employment || "Terms to confirm") + "</small>",
    escape(job.department) + "<small>" + escape(job.location) + "</small>",
    String(candidates.filter((candidate) => candidate.job_id === job.id && candidate.stage === "Hired").length) + " / " + escape(job.headcount || "1") + " hired",
    escape(job.target_date || "To confirm"),
    tag(job.status, job.status === "Open" ? "good" : "") + (Number(job.headcount || 1) <= candidates.filter((c) => c.job_id === job.id && c.stage === "Hired").length ? "<small>Hiring target reached \\xB7 review position status</small>" : ""),
    '<div class="row-actions">' + btn("Manage", "job", job.id) + dangerBtn("Move to Trash", "delete-record", job.id) + (job.profile === "client-acquisition-v1" ? btn("Full job description", "job", job.id) : "") + "</div>"
  ]);
  return heading(
    "Recruitment management",
    "Keep roles, next actions and hiring decisions moving.",
    '<div class="toolbar">' + btn("Export records", "export") + btn("+ Open position", "job") + btn("+ Add candidate", "candidate", "", true) + "</div>"
  ) + '<div class="metrics" aria-label="Current pipeline counts">' + metrics + "</div>" + panel(
    "Today\\u2019s priorities",
    queue.length ? candidateTable(queue.slice(0, 5)) : empty(candidates.length ? "No pending actions. All active candidates are on track or the hiring process is complete." : "No candidates added yet. Add a candidate to get started."),
    btn("View all actions", "attention")
  ) + panel("Upcoming interviews", bookingPreview(), btn("Open calendar", "interviews-view")) + panel(
    "Positions",
    jobRows.length ? table(["Role", "Department / market", "Headcount", "Target date", "Status", "Action"], jobRows) : empty("Open a position, define the role requirements, then add candidates."),
    tag(openJobs.length + " open \\xB7 " + active.length + " active candidates")
  ) + panel("Recent candidates", candidateTable(candidates.slice(0, 6)), btn("View pipeline", "pipeline-view"));
}
function filteredCandidates() {
  const group = groupStages.find(([name]) => "group:" + name === stageFilter);
  const query = search.trim().toLowerCase();
  const list = state.candidates.filter((candidate) => {
    const stageMatch = !stageFilter || (group ? group[1].includes(candidate.stage) : candidate.stage === stageFilter);
    const flag = attention(candidate);
    return stageMatch && (!jobFilter || candidate.job_id === jobFilter) && (!ownerFilter || candidate.owner === ownerFilter) && (!attentionFilter || (attentionFilter === "needs-action" ? !["On track", "Closed"].includes(flag) : flag === attentionFilter)) && (!query || [candidate.alias, candidate.source, candidate.owner, jobTitle(candidate.job_id)].some((value) => String(value || "").toLowerCase().includes(query)));
  });
  if (sort === "due") list.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || b.revision - a.revision);
  if (sort === "code") list.sort((a, b) => a.alias.localeCompare(b.alias, void 0, { numeric: true }));
  return list;
}
function candidateResults() {
  const list = filteredCandidates();
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  currentPage = Math.min(currentPage, pages);
  const start = (currentPage - 1) * pageSize;
  return '<p class="result-count" role="status">' + list.length + " candidates \\xB7 page " + currentPage + " of " + pages + "</p>" + (list.length ? candidateTable(list.slice(start, start + pageSize)) : empty(state.candidates.length ? "No candidates match these filters. Clear filters to see all candidates." : "No candidates added yet.") + '<div class="toolbar">' + btn("Clear filters", "reset") + btn("+ Add candidate", "candidate", "", true) + "</div>") + (pages > 1 ? '<div class="pagination">' + (currentPage > 1 ? btn("Previous", "previous") : "") + (currentPage < pages ? btn("Next", "next") : "") + "</div>" : "");
}
function pipeline() {
  return heading(
    "Candidate pipeline",
    "Filter by role, stage, owner or outstanding action.",
    '<div class="toolbar">' + btn("Export CSV", "csv") + btn("+ Add candidate", "candidate", "", true) + "</div>"
  ) + panel("Candidates", '<div class="filters"><label class="field">Search<input id="search" type="search" maxlength="100" placeholder="Candidate code, role or source" value="' + escape(search) + '"></label><label class="field">Position<select id="job-filter">' + options([["", "All positions"], ...state.jobs.map((job) => [job.id, job.title])], jobFilter) + '</select></label><label class="field">Stage<select id="stage-filter">' + options([["", "All stages"], ...groupStages.map(([name]) => ["group:" + name, name + " group"]), ...stages], stageFilter) + '</select></label><label class="field">Action owner<select id="owner-filter">' + options([["", "All owners"], ...owners], ownerFilter) + '</select></label><label class="field">Attention<select id="attention-filter">' + options([["", "All candidates"], ["needs-action", "Needs action"], "Overdue", "Due today", "Needs decision", "Missing next step", "Closed"], attentionFilter) + '</select></label><label class="field">Sort<select id="sort-filter">' + options([["recent", "Newest first"], ["due", "Due date"], ["code", "Candidate code"]], sort) + '</select></label></div><div id="candidate-results">' + candidateResults() + "</div>", btn("Reset filters", "reset"));
}
var loadedReportDates = /* @__PURE__ */ new Set();
async function loadReport(date) {
  if (loadedReportDates.has(date)) return;
  loadedReportDates.add(date);
  try {
    ingest(await loadEvents(0, { date }));
    if (page() === "activity" && reportDate === date) render();
  } catch (err2) {
    loadedReportDates.delete(date);
    flash(err2.message);
  }
}
function activity() {
  if (!loadedReportDates.has(reportDate)) loadReport(reportDate);
  const daily = visibleEvents(events).filter((event) => event.event_date === reportDate).slice().reverse();
  const summaries = daily.filter((event) => event.kind === "summary");
  const entries = daily.filter((event) => event.kind !== "summary");
  const aliases = new Map(state.candidates.map((candidate) => [candidate.id, candidate.alias]));
  const metrics = ["Candidate sourced", "First outreach", "R1 completed", "R2 completed", "Offer sent", "Hired"];
  return heading("Daily activity", "Progress, decisions and next workday priorities in Sri Lanka time.", btn("+ Daily summary", "summary", "", true)) + panel(
    "Daily report",
    '<div class="statline">' + metrics.map((label) => tag(label + " \\xB7 " + entries.filter((event) => eventLabel(event) === label).length)).join("") + "</div>",
    '<label class="field">Report date (SL)<input type="date" id="report-date" value="' + escape(reportDate) + '"></label>'
  ) + '<div class="split">' + panel("COO updates", summaries.length ? '<ul class="timeline">' + summaries.map((event) => "<li><strong>Progress</strong><p>" + escape(event.payload.progress) + "</p><strong>Blockers / decisions</strong><p>" + escape(event.payload.blockers || "None recorded") + "</p><strong>Next priorities</strong><p>" + escape(event.payload.priorities) + "</p><time>" + escape(new Date(event.created_at).toLocaleString("en-LK", { timeZone: "Asia/Colombo" })) + " SL</time>" + eventControls(event) + "</li>").join("") + "</ul>" : empty("No summary for this date. Add one to record the COO handover.")) + panel("Event log", entries.length ? '<ul class="timeline">' + entries.slice(0, 100).map((event) => "<li><strong>" + escape(eventLabel(event)) + "</strong><p>" + escape(aliases.get(event.subject_id || event.id) || event.payload.title || "") + (event.payload.note ? " \\xB7 " + escape(event.payload.note) : "") + "</p>" + eventControls(event) + "</li>").join("") + "</ul>" + (entries.length > 100 ? '<p class="muted">Showing the latest 100 events. Export records for the complete history.</p>' : "") : empty("No activity recorded for this date.")) + "</div>";
}
function scheduledInterviews() {
  return state.candidates.flatMap((candidate) => {
    const round = candidate.stage === "R1 Scheduled" ? "R1" : candidate.stage === "R2 Scheduled" ? "R2" : "";
    const slot = round && candidate[round.toLowerCase()];
    return slot ? [{ candidate, round, slot }] : [];
  }).sort((a, b) => a.slot.localeCompare(b.slot));
}
function interviews() {
  const bookings = scheduledInterviews();
  return heading("Interview calendar", "Bookings in Sri Lanka time (UTC+05:30). Add, reschedule or cancel interviews here.") + panel("Scheduled interviews", bookings.length ? table(
    ["Candidate", "Position", "Round", "Sri Lanka time", "Actions"],
    bookings.map(({ candidate, round, slot }) => [
      "<strong>" + escape(candidate.alias) + "</strong>",
      escape(jobTitle(candidate.job_id)),
      tag(round, "blue"),
      escape(slot.replace("T", " ")) + (slot.slice(0, 10) < dateSL() ? "<small>Past date \\xB7 review the candidate stage</small>" : ""),
      '<div class="row-actions">' + btn("Zoom & reminder", "interview-details", candidate.id, true) + btn("Calendar file", "calendar", candidate.id) + btn("Reschedule", "stage", candidate.id, true) + btn("Cancel interview", "cancel-interview", candidate.id) + "</div>"
    ])
  ) : empty("No interviews are booked. Use Schedule R1 or Schedule R2 for an active candidate below.")) + panel("Schedule an interview", state.candidates.some((c) => !closed.includes(c.stage)) ? table(["Candidate", "Current stage", "Actions"], state.candidates.filter((c) => !closed.includes(c.stage)).map((c) => [escape(c.alias), tag(c.stage), '<div class="row-actions">' + btn("Schedule R1", "schedule-r1", c.id) + btn("Schedule R2", "schedule-r2", c.id) + btn("View record", "view", c.id) + "</div>"])) : empty(state.candidates.length ? "All current candidates are hired, rejected or withdrawn. Closed candidates are not shown for scheduling." : "No candidates added yet. Add a candidate to schedule the first interview."), btn("+ Add candidate", "candidate", "", true));
}
var relationsPrompts = [
  ["Opening", 3, "Confirm the role, commission or payment structure, client markets and the interview plan."],
  ["Prospect research", 10, "Present six slides on one target account, their likely need, decision maker, outreach angle, follow-up plan and success measures."],
  ["Defence", 10, "Explain the account choice, the evidence behind the proposed need, what AI suggestions you rejected, and the first metric you would track."],
  ["Client role-play", 20, "Handle an unhappy client, an unrealistic promise request, a budget objection, a confidentiality request and an interruption. Agree a concrete next step."],
  ["Team behaviours", 10, "Use four questions from the existing team behaviours question bank."],
  ["Candidate questions", 5, "Discuss the role and ways of working."],
  ["Close", 2, "Confirm references, outstanding checks and the decision timeline."]
];
function guideView() {
  const original = (guideTrack === "Social media" ? ["R1", "R2", "Bank", "Other"] : ["Bank", "Other"]).map((key) => {
    const title = { R1: "Screening \\xB7 30 min", R2: "Technical \\xB7 60 min", Bank: "Team behaviours", Other: "Scoring and workflow" }[key];
    return '<section class="panel"><details' + (key === "R1" ? " open" : "") + "><summary>" + title + "</summary>" + guide_default.filter(([round]) => key === "Other" ? !["R1", "R2", "Bank"].includes(round) : round === key).map(([, section, minutes, prompt, note]) => '<div class="guide-item"><strong>' + escape(section) + (minutes ? " \\xB7 " + minutes + " min" : "") + "</strong><p>" + escape(prompt) + "</p>" + (note ? "<small>" + escape(note) + "</small>" : "") + "</div>").join("") + "</details></section>";
  }).join("");
  return heading(
    "Interview guide",
    "Use consistent prompts and record observable evidence.",
    '<label class="field">Role track<select id="guide-track">' + options(["Social media", "Client Acquisition & Relations"], guideTrack) + "</select></label>"
  ) + (guideTrack === "Social media" ? original : panel("Client Acquisition & Relations \\xB7 Screening", hiringRole.screening.map(([label, prompt]) => '<div class="guide-item"><strong>' + escape(label) + "</strong><p>" + escape(prompt) + "</p></div>").join("")) + panel(
    "Client Acquisition & Relations \\xB7 Round 2",
    '<p class="muted">Use the screening and team behaviours prompts below, with this role-specific technical brief.</p>' + relationsPrompts.map(([label, minutes, prompt]) => '<div class="guide-item"><strong>' + escape(label) + " \\xB7 " + minutes + " min</strong><p>" + escape(prompt) + "</p></div>").join("")
  ) + original);
}
function render() {
  const activeId = document.activeElement?.id;
  const selection = activeId === "search" ? [
    document.activeElement.selectionStart,
    document.activeElement.selectionEnd
  ] : null;
  const view = page();
  for (const link of document.querySelectorAll("#nav a")) {
    const selected = link.hash === "#" + view;
    link.classList.toggle("active", selected);
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const screens = { overview, coo: cooView, role: roleView, pipeline, activity, interviews, guide: guideView, trash: trashView };
  const drafts = storageDrafts();
  const draftBanner = drafts.map((draft) => '<div class="draft-banner"><span><strong>' + escape(draftTitle(draft)) + "</strong><small>" + escape(draft.saved_at ? "Draft saved " + new Date(draft.saved_at).toLocaleString("en-LK", { timeZone: "Asia/Colombo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " SL" : "Unsaved draft \\xB7 saved time unavailable") + '</small></span><div class="row-actions">' + btn("Resume draft", "resume", draft.kind + ":" + draft.id) + btn("Discard draft", "discard", draft.kind + ":" + draft.id) + "</div></div>").join("");
  const alert = failure ? '<p class="banner" role="alert">' + escape(failure) + " Existing records remain visible. Use Refresh to retry.</p>" : "";
  app.innerHTML = alert + draftBanner + (!ready && view !== "guide" ? panel("Recruitment workspace", empty(failure ? "The shared records could not be loaded." : "Loading shared records\\u2026")) : screens[view]());
  const active = activeId && document.getElementById(activeId);
  if (active && app.contains(active)) {
    active.focus({ preventScroll: true });
    if (selection) active.setSelectionRange(...selection);
  }
}
function field(name, label, { kind = "text", value = "", choices = [], required = false, max: max2 = 240, wide = false } = {}) {
  const attributes = 'name="' + escape(name) + '"' + (required ? " required" : "");
  let input;
  if (kind === "select") input = "<select " + attributes + ">" + options(choices, value) + "</select>";
  else if (kind === "textarea") input = "<textarea " + attributes + ' maxlength="' + max2 + '">' + escape(value) + "</textarea>";
  else input = '<input type="' + escape(kind) + '" ' + attributes + ' value="' + escape(value) + '"' + (kind === "text" ? ' maxlength="' + max2 + '"' : "") + (kind === "number" ? ' min="1" max="999" step="1"' : "") + ">";
  return '<label class="field' + (wide ? " wide" : "") + '">' + escape(label) + (required ? ' <span class="required" aria-hidden="true">*</span>' : "") + input + "</label>";
}
var select = (name, label, choices, value) => field(name, label, { kind: "select", choices, value, required: true });
var notes = (name, label, required = false, value = "") => field(name, label, { kind: "textarea", wide: true, required, max: 600, value });
function show(html) {
  focusReturn = document.activeElement;
  dialog.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
async function showRecord(candidate) {
  const request2 = newId();
  show('<h2 id="dialog-title">Loading candidate history</h2>' + btn("Close", "close"));
  dialog.dataset.recordRequest = request2;
  try {
    ingest(await loadEvents(0, { subject: candidate.id }));
  } catch (err2) {
    if (dialog.open && dialog.dataset.recordRequest === request2) show('<h2 id="dialog-title">History unavailable</h2><p>' + escape(err2.message) + "</p>" + btn("Close", "close"));
    return;
  }
  if (!dialog.open || dialog.dataset.recordRequest !== request2) return;
  candidate = candidateById(candidate.id);
  const checklist = checklistItems.map(([key, label]) => "<li><span>" + escape(label) + "</span>" + tag(
    candidate.checklist[key] || "Pending",
    candidate.checklist[key] === "Complete" ? "good" : ""
  ) + "</li>").join("");
  const history = candidate.history.slice().reverse().map((event) => {
    const title = historyTitle(event, candidate);
    const labels = { stage: "Hiring stage", terms: "Role and payment terms", writing: "Practical task", references: "References", offer: "Offer acceptance", agreement: "Agreement", nda: "NDA", r1: "Round 1 interview (SL)", r2: "Round 2 interview (SL)", commission_ack: "Commission acknowledgement", commission_plan: "Commission structure", terms_detail: "Agreed terms", start_date: "Start date", action: "Next action", due: "Due date", owner: "Responsible person", alias: "Candidate code", source: "Source", availability: "Availability", notice: "Notice period", market: "Client markets", round: "Interview round", reviewer: "Reviewer", recommendation: "Recommendation", score1: "Criterion 1 score", score2: "Criterion 2 score", score3: "Criterion 3 score", score4: "Criterion 4 score", cv_state: "CV availability", cover_state: "Cover letter availability" };
    const recorded = Object.entries(event.payload).filter(([key, value]) => value && !["job_id", "upload_fingerprint", "supersedes", "event", "note"].includes(key)).map(([key, value]) => "<dt>" + escape(labels[key] || key.replaceAll("_", " ")) + "</dt><dd>" + escape(value.replace(/^(\\d{4}-\\d{2}-\\d{2})T/, "$1 ")) + "</dd>").join("");
    return "<li><strong>" + escape(title) + '</strong><time class="history-date">' + escape(event.event_date) + " \\xB7 SL</time>" + (event.payload.note ? "<p>" + escape(event.payload.note) + "</p>" : "") + (recorded ? '<details><summary>View recorded details</summary><dl class="record-details">' + recorded + "</dl></details>" : "") + eventControls(event) + "</li>";
  }).join("");
  const missing = ["cv", "cover"].filter((type) => candidate.documents?.[type] !== "Available");
  const complete = checklistItems.filter(([key]) => ["Complete", "Waived"].includes(candidate.checklist[key])).length;
  const suggested = nextCandidateAction(candidate);
  show('<div class="section-top"><h2 id="dialog-title">' + escape(candidate.alias) + "</h2>" + btn("Close", "close") + '</div><p class="muted">' + escape(jobTitle(candidate.job_id)) + " \\xB7 " + escape(candidate.stage) + '</p><div class="next-action-card"><span class="eyebrow">Recommended next action</span><p>' + escape(suggested.description) + "</p>" + btn(suggested.label, suggested.action, candidate.id, true) + '</div><section class="readiness-summary" aria-label="Candidate readiness"><strong>Hiring checklist: ' + complete + "/" + checklistItems.length + " complete or waived</strong><p>" + (missing.length ? escape(missing.length + " application document" + (missing.length > 1 ? "s" : "") + " need upload or verification.") : "Both application documents verified at the last recorded check.") + '</p><div class="statline">' + tag("CV: " + (candidate.documents?.cv || "Missing"), candidate.documents?.cv === "Available" ? "good" : "warn") + tag("Cover letter: " + (candidate.documents?.cover || "Missing"), candidate.documents?.cover === "Available" ? "good" : "warn") + tag("Commission: " + (candidate.commission_ack || "Pending"), candidate.commission_ack === "Accepted" ? "good" : "warn") + '</div></section><details class="candidate-tools"><summary>All candidate actions</summary><div class="tool-group"><h3>Progress and details</h3><div class="toolbar">' + btn("Update stage / schedule", "stage", candidate.id) + btn("Log milestone", "activity", candidate.id) + btn("Correct candidate details", "correction", candidate.id) + '</div></div><div class="tool-group"><h3>Documents and assessment</h3><div class="toolbar">' + btn("CV & cover letter", "documents", candidate.id) + btn("Scorecard", "score", candidate.id) + btn("Hiring checklist", "checklist", candidate.id) + btn("Commission review", "commission", candidate.id) + '</div></div><div class="tool-group danger-zone"><h3>Record management</h3>' + dangerBtn("Move candidate to Trash", "delete-record", candidate.id) + '</div></details><details class="readiness-details"><summary>Hiring checklist details</summary><ul class="checklist">' + checklist + '</ul></details><details class="history-section"><summary>Record history (' + candidate.history.length + ' entries)</summary><ul class="timeline">' + history + "</ul></details>");
}
function openForm(kind, id = "", restored = null) {
  saveDraft();
  const existingDraft = storageRead(kind, id);
  if (!restored && existingDraft) return openForm(kind, id, existingDraft);
  const candidate = candidateById(id) || candidateById(events.find((e) => e.id === id)?.subject_id);
  const job = state.jobs.find((item) => item.id === id);
  const openJobs = state.jobs.filter((item) => item.status === "Open");
  if (["stage", "activity", "score", "checklist", "correction", "commission"].includes(kind) && !candidate) {
    show('<h2 id="dialog-title">Restore the candidate first</h2><p>This candidate is no longer in the active workspace. Restore it from Trash before continuing.</p>' + btn("Open Trash", "trash-view") + btn("Close", "close"));
    return;
  }
  if (kind === "candidate" && !openJobs.length) {
    show('<h2 id="dialog-title">Open a position first</h2><p>A candidate must belong to an open position.</p>' + btn("Open a position", "job", "", true) + btn("Close", "close"));
    return;
  }
  const required = { required: true };
  const next = (value = {}) => '<fieldset class="form-grid wide" id="next-fields"><legend>Next action</legend>' + field("action", "Next step", { ...required, value: value.action }) + field("due", "Due date (SL)", { ...required, kind: "date", value: value.due }) + select("owner", "Owner", [["", "Choose owner"], ...owners], value.owner) + field("blocker", "Blocker / decision needed", { value: value.blocker }) + "</fieldset>";
  let title;
  let fields;
  if (kind === "recordaction") {
    const target = events.find((event) => event.id === id);
    if (!target) return;
    const deleted = Boolean(recordStates(events).get(id)?.deleted);
    title = (deleted ? "Restore" : "Move to Trash") + " \\xB7 " + recordTitle(target);
    fields = '<input type="hidden" name="operation" value="' + (deleted ? "restore" : "delete") + '"><input type="hidden" name="target_id" value="' + escape(id) + '">' + notes("note", deleted ? "Restoration reason" : "Deletion reason", true) + '<p class="hint wide">' + (deleted ? "Restoring makes this record available again." : "This moves the record to Trash. You can restore it later. Original files and audit history are preserved.") + "</p>";
  } else if (kind === "job") {
    title = job ? "Manage position" : "Open a position";
    fields = field("title", "Job title", { ...required, value: job?.title }) + field("department", "Department", { ...required, value: job?.department || "Client Services" }) + field("location", "Location / market", { ...required, value: job?.location || "Sri Lanka \\xB7 Remote" }) + select("employment", "Engagement type", employmentTypes, job?.employment || "Contract") + field("headcount", "Target headcount", { ...required, kind: "number", value: job?.headcount || "1" }) + field("target_date", "Target hiring date", { kind: "date", value: job?.target_date }) + notes("brief", "Role requirements / success criteria", true, job?.brief || "") + field("description", "Full job description (public-safe)", { kind: "textarea", wide: true, max: 12e3, value: job?.description || "" }) + (job ? select("status", "Position status", ["Open", "Paused", "Closed"], job.status) + notes("note", "Reason for update", true) : "");
  } else if (kind === "candidate") {
    title = "Add a candidate";
    fields = field("alias", "Candidate code", { required: true, max: 40, value: "QE-" + dateSL().replaceAll("-", "") + "-" + newId().slice(0, 6).toUpperCase() }) + select("source", "Source", sources, sources[0]) + '<div class="wide">' + select("job_id", "Position", openJobs.map((item) => [item.id, item.title]), openJobs[0].id) + '</div><p class="hint wide">A unique code is generated for you. Add documents and confirm terms after creating the candidate.</p><details class="wide form-section"><summary>Availability and client markets (optional)</summary><div class="form-grid">' + select("availability", "Availability", ["To confirm", "Available now", "Within 2 weeks", "Within 1 month", "Later"], "To confirm") + field("notice", "Notice period", { value: "To confirm" }) + field("market", "Target client markets", { value: "To confirm" }) + '</div></details><details class="wide form-section"><summary>Commission terms (optional for now)</summary><div class="form-grid">' + select("commission_plan", "Commission structure", ["10 / 20 / 30 recurring", "Other agreed terms"], "10 / 20 / 30 recurring") + select("commission_ack", "Candidate accepts commission-only terms", ["Pending", "Accepted", "Declined"], "Pending") + notes("terms_detail", "Agreed commission boundaries / exceptions (required when accepted)", false, "") + '</div></details><details class="wide form-section"><summary>Next action (defaults to COO review tomorrow)</summary>' + next({ action: "Review application", due: tomorrowSL(), owner: "COO" }) + "</details>";
  } else if (kind === "stage" && candidate) {
    title = "Update \\xB7 " + candidate.alias;
    fields = select("stage", "Stage", stages, candidate.stage) + next(candidate) + field("r1", "R1 interview (Sri Lanka time)", { kind: "datetime-local", value: candidate.r1 }) + field("r2", "R2 interview (Sri Lanka time)", { kind: "datetime-local", value: candidate.r2 }) + '<div class="wide" id="start-field">' + field("start_date", "Confirmed start date", { kind: "date", value: candidate.start_date }) + "</div>" + notes("note", "Reason / decision summary", true) + '<div class="hint wide" id="schedule-help" role="status"></div>' + (candidate.commission_ack !== "Accepted" || !candidate.terms_detail ? '<div class="wide"><p class="hint">Confirm commission terms before scheduling an interview.</p>' + btn("Review commission terms", "commission", candidate.id) + "</div>" : "") + '<p class="hint wide">To cancel a booking, clear its time and select the next stage. Previous bookings stay in history. Complete the hiring checklist before marking Hired.</p>';
  } else if (kind === "checklist" && candidate) {
    title = "Hiring checklist \\xB7 " + candidate.alias;
    fields = checklistItems.map(([key, label]) => select(
      key,
      label,
      ["Pending", "Complete", "Waived"],
      candidate.checklist[key] || "Pending"
    )).join("") + notes("note", "Evidence summary / reasons for any waiver", true);
  } else if (kind === "activity" && candidate) {
    title = "Log milestone \\xB7 " + candidate.alias;
    fields = select("event", "Milestone", milestones.filter((x2) => !["Commission terms reviewed", "Candidate details corrected", "Document availability checked"].includes(x2)), milestones[0]) + notes("note", "Public progress summary", true);
  } else if (kind === "score" && candidate) {
    title = "Scorecard \\xB7 " + candidate.alias;
    fields = select("round", "Round", ["R1", "R2"], "R1") + select("reviewer", "Reviewer role", ["COO", "Leadership"], "COO") + select("recommendation", "Recommendation", ["Advance", "Hold", "Reject"], "Advance") + '<div class="form-grid wide" id="round-fields"></div>' + notes("note", "Observable evidence", true);
  } else if (kind === "correction" && candidate) {
    title = "Correct candidate details \\xB7 " + candidate.alias;
    fields = field("alias", "Candidate code", { required: true, max: 40, value: candidate.alias }) + select("source", "Source", sources, candidate.source) + select("availability", "Availability", ["To confirm", "Available now", "Within 2 weeks", "Within 1 month", "Later"], candidate.availability || "To confirm") + field("notice", "Notice period", { required: true, value: candidate.notice || "To confirm" }) + field("market", "Target client markets", { value: candidate.market || "" }) + notes("note", "Correction reason (original history is preserved)", true);
  } else if (kind === "commission" && candidate) {
    title = "Commission review \\xB7 " + candidate.alias;
    fields = select("commission_plan", "Agreed structure", ["10 / 20 / 30 recurring", "Other agreed terms"], candidate.commission_plan || "10 / 20 / 30 recurring") + select("commission_ack", "Candidate acknowledgement", ["Pending", "Accepted", "Declined"], candidate.commission_ack || "Pending") + notes("terms_detail", "Agreed boundaries and exceptional terms (including AUD 1,000)", true, candidate.terms_detail || "") + notes("note", "Terms explained / next action (public-safe)", true);
  } else if (kind === "summary") {
    title = "Daily COO summary";
    fields = notes("progress", "Progress today", true) + notes("blockers", "Blockers / leadership decisions") + notes("priorities", "Next workday priorities", true);
  } else return;
  const revision = restored?.revision ?? (kind === "recordaction" ? Math.max(recordStates(events).get(id)?.revision || events.find((e) => e.id === id)?.seq || 0, candidateById(id)?.revision || 0, state.jobs.find((j) => j.id === id)?.revision || 0) : candidate?.revision ?? job?.revision) ?? 0;
  const submitLabel = formActionLabel(kind, id, Boolean(restored?.values?.supersedes));
  show('<form id="entry" data-kind="' + escape(kind) + '" data-id="' + escape(id) + '" data-request="' + escape(restored?.request || newId()) + '" data-revision="' + revision + '"><div class="section-top"><h2 id="dialog-title">' + escape(title) + "</h2>" + btn("Close", "close") + '</div><p class="public-note">Public workspace. Use candidate codes and public-safe notes. Fields marked * are required.</p><div class="form-grid">' + (["candidate", "recordaction"].includes(kind) ? '<input type="hidden" name="event_date" value="' + escape(dateSL()) + '">' : field("event_date", "Event date (SL)", { kind: "date", required: true, value: kind === "summary" ? reportDate : dateSL() })) + fields + '</div><p class="form-error" role="alert"></p><div class="form-actions">' + btn("Discard draft", "discard") + '<button class="btn primary' + (kind === "recordaction" && !recordStates(events).get(id)?.deleted ? " danger" : "") + '" type="submit">' + escape(submitLabel) + "</button></div></form>");
  pendingRecord = restored?.pending || null;
  if (kind === "score") setRoundFields(restored?.values?.round || "R1");
  if (restored?.values?.supersedes) {
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.name = "supersedes";
    hidden.value = restored.values.supersedes;
    dialog.querySelector("#entry").append(hidden);
  }
  if (restored?.values) {
    for (const [key, value] of Object.entries(restored.values)) {
      const input = dialog.querySelector("#entry").elements.namedItem(key);
      if (input) input.value = value;
    }
  }
  updateStageFields();
  if (pendingRecord) freezePending();
  const openedForm = dialog.querySelector("#entry");
  openedForm.dataset.baseline = JSON.stringify(draftValues(openedForm));
  openedForm.dataset.restored = restored ? "1" : "";
  openedForm.dataset.submitLabel = submitLabel;
  openedForm.addEventListener("invalid", (event) => {
    const input = event.target;
    for (let d = input.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
  }, true);
  dialog.querySelector(kind === "candidate" ? '[name="alias"]' : 'input:not([type="hidden"]),select,textarea')?.focus();
}
function setRoundFields(round) {
  const form = dialog.querySelector("#entry");
  const cache = JSON.parse(form.dataset.roundScores || "{}");
  if (form.dataset.scoreRound) cache[form.dataset.scoreRound] = Object.fromEntries([...form.querySelectorAll("#round-fields select")].map((i2) => [i2.name, i2.value]));
  form.dataset.roundScores = JSON.stringify(cache);
  form.dataset.scoreRound = round;
  const job = state.jobs.find((j) => j.id === (candidateById(form.dataset.id) || candidateById(events.find((e) => e.id === form.dataset.id)?.subject_id))?.job_id);
  dialog.querySelector("#round-fields").innerHTML = scorecardFor(job)[round].map((label, i2) => field("score" + (i2 + 1), label, { kind: "select", value: cache[round]?.["score" + (i2 + 1)] || "", choices: [["", "Untested"], "1", "2", "3", "4", "5"] })).join("");
}
function updateStageFields() {
  const stage = dialog.querySelector('[name="stage"]')?.value;
  if (!stage) return;
  dialog.querySelector("#next-fields").disabled = closed.includes(stage);
  const start = dialog.querySelector("#start-field");
  start.hidden = stage !== "Hired";
  start.querySelector("input").required = stage === "Hired";
  const scheduled = stage === "R1 Scheduled" || stage === "R2 Scheduled";
  dialog.querySelector("#schedule-help").textContent = scheduled ? "This save books the selected interview in the calendar. All times are Sri Lanka time (UTC+05:30)." : "Interview times are reference details until Stage is R1 Scheduled or R2 Scheduled. Choose a scheduled stage to book the calendar.";
  for (const round of ["r1", "r2"]) {
    dialog.querySelector('[name="' + round + '"]').required = stage === (round === "r1" ? "R1 Scheduled" : "R2 Scheduled");
  }
}
function draftValues(form) {
  const result = {};
  for (const input of form.querySelectorAll("[name]")) result[input.name] = input.value;
  return result;
}
function saveDraft() {
  if (!dialog.open) return;
  const form = dialog.querySelector("#entry");
  if (!form) return;
  const values = draftValues(form);
  if (!pendingRecord && !form.dataset.restored && JSON.stringify(values) === form.dataset.baseline) return;
  storageWrite({
    kind: form.dataset.kind,
    id: form.dataset.id,
    request: form.dataset.request,
    saved_at: (JSON.stringify(storageRead(form.dataset.kind, form.dataset.id)?.values) === JSON.stringify(values) ? storageRead(form.dataset.kind, form.dataset.id)?.saved_at : null) || (/* @__PURE__ */ new Date()).toISOString(),
    revision: Number(form.dataset.revision),
    values,
    pending: pendingRecord
  });
}
function freezePending() {
  for (const input of dialog.querySelectorAll("input,select,textarea")) input.disabled = true;
  const submit = dialog.querySelector('[type="submit"]');
  submit.textContent = "Retry same save";
}
function flash(text) {
  notice.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.textContent = "";
  }, 6e3);
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
}
function calendar(candidate) {
  const round = candidate.stage === "R1 Scheduled" ? "R1" : "R2";
  const slot = candidate[round.toLowerCase()];
  if (!slot) return;
  const start = /* @__PURE__ */ new Date(slot + ":00+05:30");
  const end = new Date(+start + (round === "R1" ? 30 : 60) * 6e4);
  const stamp = (date) => date.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const safe = (value) => String(value).replaceAll("\\\\", "\\\\\\\\").replaceAll(";", "\\\\;").replaceAll(",", "\\\\,").replace(/\\r?\\n/g, "\\\\n");
  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//QuidEdge//Recruitment//EN",
    "BEGIN:VEVENT",
    "UID:" + candidate.id + "-" + round + "@quidedge",
    "DTSTAMP:" + stamp(/* @__PURE__ */ new Date()),
    "DTSTART:" + stamp(start),
    "DTEND:" + stamp(end),
    "SUMMARY:" + safe(candidate.alias + " " + round + " interview"),
    "DESCRIPTION:" + safe(jobTitle(candidate.job_id)),
    "SEQUENCE:" + candidate.revision,
    "END:VEVENT",
    "END:VCALENDAR",
    ""
  ].map(foldCalendarLine).join("\\r\\n");
  download(candidate.alias + "-" + round + ".ics", content, "text/calendar;charset=utf-8");
}
async function refresh() {
  if (refreshing || saving || !navigator.onLine) return;
  refreshing = true;
  sync.disabled = true;
  try {
    const incoming = await readUpdates();
    const changed = ingest(incoming);
    const hadFailure = Boolean(failure);
    failure = "";
    const initial = !ready;
    ready = true;
    mode.textContent = "Synced \\xB7 " + (/* @__PURE__ */ new Date()).toLocaleTimeString("en-LK", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Colombo" }) + " SL";
    sync.className = "pill live";
    const today = dateSL(), dayChanged = today !== lastDay;
    if (dayChanged) {
      if (reportDate === lastDay) reportDate = today;
      lastDay = today;
    }
    if (changed || initial || hadFailure || dayChanged) render();
    else if (page() === "coo") loadMaintenanceStatus();
  } catch (error) {
    failure = error.message;
    mode.textContent = "Retry sync";
    sync.className = "pill error";
    render();
  } finally {
    refreshing = false;
    sync.disabled = false;
  }
}
function resetFilters() {
  stageFilter = "";
  jobFilter = "";
  ownerFilter = "";
  attentionFilter = "";
  search = "";
  currentPage = 1;
}
app.addEventListener("input", (event) => {
  if (event.target.id !== "search") return;
  search = event.target.value;
  currentPage = 1;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const result = app.querySelector("#candidate-results");
    if (result) result.innerHTML = candidateResults();
  }, 120);
});
app.addEventListener("change", (event) => {
  const value = event.target.value;
  const key = event.target.id;
  if (key === "report-date" && value) reportDate = value;
  if (key === "stage-filter") stageFilter = value;
  if (key === "job-filter") jobFilter = value;
  if (key === "attention-filter") attentionFilter = value;
  if (key === "owner-filter") ownerFilter = value;
  if (key === "sort-filter") sort = value;
  if (key === "guide-track") guideTrack = value;
  currentPage = 1;
  render();
});
document.addEventListener("click", async (event) => {
  if (event.target.closest(".skip")) {
    event.preventDefault();
    app.focus();
    return;
  }
  const control = event.target.closest("[data-action]");
  if (!control || saving) return;
  const { action, id } = control.dataset;
  if (action === "interview-details") {
    saveDraft();
    await showInterviewDetails(id);
    return;
  }
  if (action === "pipeline-view") {
    location.hash = "pipeline";
    render();
    return;
  }
  if (action === "interviews-view") {
    location.hash = "interviews";
    render();
    return;
  }
  if (action === "overview-view") {
    location.hash = "overview";
    render();
    return;
  }
  if (action === "trash-view") {
    if (dialog.open) {
      saveDraft();
      dialog.close();
    }
    location.hash = "trash";
    render();
    return;
  }
  if (action === "delete-record" || action === "restore-record") {
    openForm("recordaction", id);
    return;
  }
  if (action === "edit-event") {
    editEvent(id);
    return;
  }
  if (["schedule-r1", "schedule-r2", "cancel-interview"].includes(action)) {
    openForm("stage", id);
    const form = dialog.querySelector("#entry");
    if (!form || form.dataset.kind !== "stage") return;
    if (action === "cancel-interview") {
      const round = candidateById(id).stage === "R1 Scheduled" ? "r1" : "r2";
      form.elements.stage.value = round === "r1" ? "Replied" : "R2 Prep";
      form.elements[round].value = "";
      form.elements.note.value = "Interview cancelled";
    } else {
      const round = action === "schedule-r1" ? "R1" : "R2";
      form.elements.stage.value = round + " Scheduled";
      form.elements.action.value = round + " interview";
    }
    const actionLabel = action === "cancel-interview" ? "Cancel interview" : action === "schedule-r1" ? "Schedule R1 interview" : "Schedule R2 interview";
    form.dataset.submitLabel = actionLabel;
    form.querySelector("[type=submit]").textContent = actionLabel;
    updateStageFields();
    saveDraft();
    return;
  }
  if (action === "close") {
    saveDraft();
    dialog.close();
    render();
    return;
  }
  if (action === "discard") {
    const form = dialog.querySelector("#entry");
    const [kind, recordId] = id ? id.split(":") : [form?.dataset.kind, form?.dataset.id];
    storageWrite(null, kind, recordId);
    pendingRecord = null;
    dialog.close();
    render();
    return;
  }
  if (action === "resume") {
    const [kind, recordId] = id.split(":");
    const draft = storageRead(kind, recordId);
    if (draft) openForm(draft.kind, draft.id, draft);
    return;
  }
  if (action === "group" || action === "attention") {
    resetFilters();
    if (action === "group") stageFilter = "group:" + id;
    else attentionFilter = "needs-action";
    location.hash = "pipeline";
    render();
    return;
  }
  if (action === "reset") {
    resetFilters();
    render();
    return;
  }
  if (action === "next" || action === "previous") {
    currentPage += action === "next" ? 1 : -1;
    render();
    return;
  }
  if (action === "view") {
    const candidate = candidateById(id);
    if (candidate) showRecord(candidate);
    return;
  }
  if (action === "role-view") {
    location.hash = "role";
    render();
    return;
  }
  if (action === "activate-role") {
    activateRole();
    return;
  }
  if (action === "verify-documents") {
    await verifyDocuments(id, control);
    return;
  }
  if (action === "documents") {
    saveDraft();
    showDocuments(candidateById(id));
    return;
  }
  if (action === "calendar") {
    calendar(candidateById(id));
    return;
  }
  if (action === "export") {
    control.disabled = true;
    flash("Preparing complete history export\\u2026");
    try {
      const all = await loadEvents(0);
      download(
        "QuidEdge-records-" + dateSL() + ".json",
        JSON.stringify({ exported_at: (/* @__PURE__ */ new Date()).toISOString(), events: all }, null, 2),
        "application/json"
      );
    } catch (err2) {
      flash(err2.message);
    } finally {
      control.disabled = false;
    }
    return;
  }
  if (action === "csv") {
    const rows = [["Code", "Position", "Stage", "Owner", "Next action", "Due", "Attention"]];
    for (const candidate of filteredCandidates()) rows.push([
      candidate.alias,
      jobTitle(candidate.job_id),
      candidate.stage,
      candidate.owner,
      candidate.action,
      candidate.due,
      attention(candidate)
    ]);
    download("QuidEdge-candidates-" + dateSL() + ".csv", rows.map((row) => row.map(csvCell).join(",")).join("\\r\\n"), "text/csv;charset=utf-8");
    return;
  }
  openForm(action, id);
});
dialog.addEventListener("input", (event) => {
  if (event.target.form?.id === "document-entry") {
    if (event.target.name === "private_name") {
      event.target.form.dataset.cvRequest = newId();
      event.target.form.dataset.coverRequest = newId();
    }
    if (["cv", "cover"].includes(event.target.name)) event.target.form.dataset[event.target.name + "Request"] = newId();
    return;
  }
  saveDraft();
});
dialog.addEventListener("change", (event) => {
  if (event.target.name === "stage") updateStageFields();
  if (event.target.name === "commission_ack") {
    const terms = dialog.querySelector('[name="terms_detail"]');
    if (terms) {
      terms.required = event.target.value === "Accepted" || dialog.querySelector("#entry")?.dataset.kind === "commission";
      if (terms.required) terms.closest("details")?.setAttribute("open", "");
    }
  }
  if (event.target.name === "round") setRoundFields(event.target.value);
  saveDraft();
});
dialog.addEventListener("cancel", (event) => {
  if (saving) event.preventDefault();
  else saveDraft();
});
dialog.addEventListener("close", () => {
  if (!saving) render();
  if (focusReturn?.isConnected) focusReturn.focus();
});
dialog.addEventListener("submit", async (event) => {
  if (event.target.id === "document-entry") {
    event.preventDefault();
    saveDocuments(event.target);
    return;
  }
  if (event.target.id !== "entry") return;
  event.preventDefault();
  if (saving) return;
  const form = event.target;
  const errorBox = form.querySelector(".form-error");
  const { kind, id } = form.dataset;
  let record = pendingRecord;
  if (!record) {
    const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
    const eventDate = values.event_date;
    delete values.event_date;
    if (kind === "candidate") values.stage = "Sourced";
    if (kind === "job" && id) values.job_id = id;
    if (kind === "correction") values.event = "Candidate details corrected";
    if (kind === "commission") values.event = "Commission terms reviewed";
    if (kind === "checklist") values.event = "Hiring checklist updated";
    if (kind === "stage") {
      if (closed.includes(values.stage)) Object.assign(values, { action: "", due: "", owner: "", blocker: "" });
      const problem = stageProblem(values, candidateById(id) || candidateById(events.find((e) => e.id === id)?.subject_id), eventDate);
      if (problem) {
        errorBox.textContent = problem;
        return;
      }
    }
    record = {
      id: form.dataset.request,
      kind: kind === "recordaction" ? "summary" : ["checklist", "commission", "correction"].includes(kind) ? "activity" : kind,
      subject_id: ["job", "summary", "recordaction"].includes(kind) ? null : values.supersedes ? events.find((e) => e.id === values.supersedes)?.subject_id : id || null,
      event_date: eventDate,
      payload: values
    };
    if (id || values.supersedes) record.expected_seq = Number(form.dataset.revision);
  }
  pendingRecord = record;
  saveDraft();
  saving = true;
  const controls = form.querySelectorAll("button,input,select,textarea");
  for (const input of controls) input.disabled = true;
  const submit = form.querySelector('[type="submit"]');
  submit.textContent = "Saving\\u2026";
  errorBox.textContent = "";
  try {
    const saved = await append(record);
    ingest([saved]);
    pendingRecord = null;
    storageWrite(null, kind, id);
    if (kind === "candidate") {
      resetFilters();
      location.hash = "pipeline";
    }
    if (kind === "summary") reportDate = record.event_date;
    dialog.close();
    render();
    flash(kind === "recordaction" ? record.payload.operation === "delete" ? "Record moved to Trash. You can restore it from Trash." : "Record restored to the workspace." : kind === "candidate" ? "Candidate " + record.payload.alias + " added. The next action is ready for review." : (form.dataset.submitLabel || "Changes") + " \\u2014 saved to the shared workspace.");
  } catch (error) {
    errorBox.textContent = error.message;
    if (error.status && error.status < 500) {
      pendingRecord = null;
      form.dataset.request = newId();
      if (error.status === 409) {
        saving = false;
        await refresh();
        if (kind === "recordaction") {
          form.dataset.revision = Math.max(recordStates(events).get(id)?.revision || events.find((e) => e.id === id)?.seq || 0, project(events).candidates.find((c) => c.id === id)?.revision || 0, project(events).jobs.find((j) => j.id === id)?.revision || 0);
        }
        const current = candidateById(id) || candidateById(events.find((e) => e.id === id)?.subject_id) || state.jobs.find((job) => job.id === id);
        if (current) {
          form.dataset.revision = current.revision;
          const changes = Object.entries(current).filter(([key, value]) => typeof value === "string" && key in draftValues(form)).map(([key, value]) => key + ": " + value).join("; ");
          const checkboxes = Object.entries(current.checklist || {}).map(([key, value]) => key + ": " + value).join("; ");
          errorBox.textContent += " Latest saved fields: " + changes + (checkboxes ? "; checklist: " + checkboxes : "") + ". Your draft is unchanged. Compare these values before saving again. Latest saved status: " + (current.stage || current.status) + ". Next action: " + (current.action || "None") + ". Review before saving again.";
        }
      }
      for (const input of controls) input.disabled = false;
      updateStageFields();
      submit.textContent = form.dataset.submitLabel || "Save changes";
      saveDraft();
    } else {
      for (const button of form.querySelectorAll("button")) button.disabled = false;
      freezePending();
      saveDraft();
    }
  } finally {
    saving = false;
  }
});
sync.addEventListener("click", refresh);
window.addEventListener("hashchange", () => {
  render();
  app.focus({ preventScroll: true });
});
window.addEventListener("online", refresh);
window.addEventListener("offline", () => {
  mode.textContent = "Offline \\xB7 draft kept";
  sync.className = "pill error";
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !dialog.open) refresh();
});
window.addEventListener("pagehide", () => {
  saveDraft();
  clearInterval(timer);
  timer = null;
});
window.addEventListener("pageshow", () => {
  if (!timer) {
    startSyncTimer();
    refresh();
  }
});
render();
refresh();
function startSyncTimer() {
  clearInterval(timer);
  timer = setInterval(() => {
    if (!document.hidden && !dialog.open) refresh();
  }, 45e3);
}
startSyncTimer();
function recordTitle(event) {
  const projected = project(events), candidate = projected.candidates.find((c) => c.id === (event.subject_id || event.id));
  return event.kind === "candidate" ? candidate?.alias || event.payload.alias : event.kind === "job" ? event.payload.title : (candidate?.alias ? candidate.alias + " \\xB7 " : "") + eventLabel(event);
}
function eventControls(event) {
  if (event.payload.operation || ["Document stored", "Document availability checked"].includes(event.payload.event)) return "";
  const editable = ["stage", "score", "summary"].includes(event.kind) || event.kind === "activity" && !["Document stored", "Document availability checked"].includes(event.payload.event);
  return '<div class="row-actions">' + (editable ? btn("Edit entry", "edit-event", event.id) : "") + dangerBtn("Move entry to Trash", "delete-record", event.id) + "</div>";
}
function trashView() {
  const states = recordStates(events), deleted = events.filter((e) => !e.payload.operation && states.get(e.id)?.deleted);
  return heading("Trash", "Restore deleted candidates, positions and entries. Original records and files are preserved.", btn("Back to overview", "overview-view")) + panel("Deleted records", deleted.length ? table(["Record", "Type", "Actions"], deleted.map((e) => [escapeTitle(e), e.kind, btn("Restore", "restore-record", e.id, true)])) : empty("Trash is empty."));
}
function escapeTitle(event) {
  return escape(recordTitle(event));
}
function editEvent(id) {
  const target = events.find((e) => e.id === id);
  if (!target) return;
  const kind = target.kind === "activity" ? { "Hiring checklist updated": "checklist", "Commission terms reviewed": "commission", "Candidate details corrected": "correction" }[target.payload.event] || "activity" : target.kind;
  const old = storageRead(kind, id);
  if (old) {
    openForm(kind, id, old);
    return;
  }
  const parent = candidateById(target.subject_id);
  const revision = parent?.revision || recordStates(events).get(id)?.revision || target.seq;
  openForm(kind, id, { kind, id, request: newId(), revision, values: { ...target.payload, event_date: target.event_date, supersedes: id } });
}
function tomorrowSL() {
  const date = /* @__PURE__ */ new Date(dateSL() + "T12:00:00+05:30");
  date.setUTCDate(date.getUTCDate() + 1);
  return dateSL(date);
}
function formActionLabel(kind, id, editing = false) {
  if (kind === "recordaction") return recordStates(events).get(id)?.deleted ? "Restore record" : "Move to Trash";
  if (editing) return "Save entry changes";
  return { candidate: "Add candidate", job: id ? "Save position changes" : "Create position", stage: "Save stage and schedule", activity: "Log milestone", score: "Save scorecard", checklist: "Save checklist", commission: "Save commission review", correction: "Save candidate details", summary: "Save daily summary" }[kind] || "Save changes";
}
function draftTitle(draft) {
  const all = project(events), target = events.find((e) => e.id === draft.id), candidate = all.candidates.find((c) => c.id === (target?.subject_id || draft.id));
  const owner = candidate?.alias || all.jobs.find((j) => j.id === draft.id)?.title || draft.values.alias || draft.values.title || "New entry";
  const labels = { stage: "Stage and schedule", candidate: "New candidate", commission: "Commission review", score: "Scorecard", checklist: "Hiring checklist", activity: "Milestone", correction: "Candidate details", recordaction: "Record management", summary: "Daily summary", job: "Position" };
  return owner + " \\u2014 " + (labels[draft.kind] || draft.kind);
}
function historyTitle(event, candidate) {
  if (event.kind === "stage") {
    const prior = candidate.history.filter((e) => e.seq < event.seq).reverse().find((e) => e.kind === "stage" || e.kind === "candidate");
    return "Stage changed: " + (prior?.payload.stage || "Sourced") + " \\u2192 " + event.payload.stage;
  }
  return eventLabel(event);
}
function nextCandidateAction(candidate) {
  if (state.jobs.find((job) => job.id === candidate.job_id)?.profile === "client-acquisition-v1" && ["cv", "cover"].some((type) => candidate.documents?.[type] !== "Available")) return { label: "Upload or verify documents", action: "documents", description: "Complete the application file record. The hiring checklist and document availability are tracked separately." };
  if (candidate.commission_ack !== "Accepted" || !candidate.terms_detail) return { label: "Review commission terms", action: "commission", description: "Record the candidate\\u2019s acknowledgement and agreed boundaries before progressing." };
  if (closed.includes(candidate.stage)) return { label: "Review candidate details", action: "correction", description: candidate.stage === "Hired" ? "Hiring completed. Review the record if any details need updating." : "This hiring process is closed. Review details or reopen it through the stage controls." };
  if (["R1 Review", "R2 Review"].includes(candidate.stage)) return { label: "Complete interview scorecard", action: "score", description: "Record observed evidence before deciding the next stage." };
  if (candidate.stage === "Offer / Agreement") return { label: "Review hiring checklist", action: "checklist", description: "Confirm all hiring requirements before marking the candidate hired." };
  if (["R1 Scheduled", "R2 Scheduled"].includes(candidate.stage)) return { label: "Review interview booking", action: "stage", description: "Confirm the interview time and next action." };
  return { label: "Review next stage", action: "stage", description: candidate.action || "Choose the next step and its owner." };
}
function bookingPreview() {
  const bookings = scheduledInterviews().filter(({ slot }) => +/* @__PURE__ */ new Date(slot + ":00+05:30") >= Date.now()).slice(0, 3);
  return bookings.length ? table(["Candidate", "Round", "Sri Lanka time", "Action"], bookings.map(({ candidate, round, slot }) => [escape(candidate.alias), escape(round), escape(slot.replace("T", " ")), btn("Review booking", "stage", candidate.id)])) : empty("No upcoming interviews are booked.");
}
async function showInterviewDetails(id) {
  const c = candidateById(id), round = c.stage === "R1 Scheduled" ? "R1" : "R2", slot = c[round.toLowerCase()];
  show("<h2>Loading meeting details\\u2026</h2>");
  try {
    const response = await fetch(apiBase + "/interviews", { cache: "no-store" }), data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not load meeting details.");
    const prior = data.meetings.find((m2) => m2.candidate_id === id), currentBooking = interviewRevision(events, c), m = prior?.round === round && prior?.slot === slot && prior?.booking_seq === currentBooking ? prior : {};
    const status = m.enabled && data.email_ready === false ? "Email activation or quota needs attention. The reminder will wait for the email service." : m.status === "sending" ? "Sending / awaiting confirmation" : m.status === "sent" ? "Email service accepted the reminder" : m.status === "needs-review" ? "Delivery could not be confirmed. Check with the recipient before scheduling another reminder." : m.status === "pending" ? "Scheduled \\u2014 checked every minute. Email delivery can take longer." : "Reminder off";
    show("<h2>Zoom & email reminder</h2><p>" + escape(c.alias + " \\xB7 " + round + " \\xB7 " + slot.replace("T", " ") + " Sri Lanka time") + '</p><p role="status">' + escape(status) + "</p>" + (data.email_ready === false ? '<p class="hint">Zoom links can be saved now. Automatic email is waiting for Google email authorization or available daily quota.</p>' : "") + (m.zoom ? '<p><a class="btn primary" target="_blank" rel="noopener noreferrer" href="' + escape(m.zoom) + '">Open Zoom meeting</a></p>' : "") + '<form id="interview-entry" class="form-grid" data-id="' + escape(id) + '" data-round="' + round + '" data-slot="' + escape(slot) + '" data-version="' + escape(prior?.version || "") + '">' + field("zoom", "Zoom meeting link", { kind: "url", value: m.zoom || "", wide: true }) + select("enabled", "Automatic email reminder", [["false", "Off"], ["true", "On"]], String(m.enabled || false)) + field("remind_at", "Send reminder at (Sri Lanka time)", { kind: "datetime-local", value: m.remind_at || "", wide: true }) + '<p class="hint wide">Recipient: prasad.quidedge@gmail.com. Choose a time before the interview. Rescheduling requires a new reminder; cancelling or moving the candidate to Trash stops pending reminders.</p><p class="form-error wide" role="alert"></p><div class="form-actions wide">' + btn("Close", "close") + '<button class="btn primary" type="submit">Save meeting details</button></div></form>');
  } catch (err2) {
    show('<h2>Meeting details unavailable</h2><p role="alert">' + escape(err2.message) + "</p>" + btn("Close", "close"));
  }
}
dialog.addEventListener("submit", async (event) => {
  if (event.target.id !== "interview-entry") return;
  event.preventDefault();
  if (saving) return;
  const form = event.target;
  const button = form.querySelector("[type=submit]");
  saving = true;
  button.disabled = true;
  button.textContent = "Saving\\u2026";
  try {
    const response = await fetch(apiBase + "/interviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate_id: form.dataset.id, round: form.dataset.round, slot: form.dataset.slot, version: form.dataset.version, zoom: form.elements.zoom.value.trim(), enabled: form.elements.enabled.value === "true", remind_at: form.elements.remind_at.value }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Could not save meeting details.");
    dialog.close();
    flash("Zoom link and reminder settings saved.");
  } catch (err2) {
    form.querySelector(".form-error").textContent = err2.message;
  } finally {
    saving = false;
    button.disabled = false;
    button.textContent = "Save meeting details";
  }
});
function roleView() {
  const r = hiringRole, job = state.jobs.find((j) => j.id === r.id), active = Boolean(job);
  if (job?.description) return heading(job.title, job.status, tag(job.status, job.status === "Open" ? "good" : "")) + panel("Full job description", '<div class="snapshot">' + escape(job.description) + "</div>") + panel("Approved compensation reference", "<p>" + escape(r.compensation) + "</p><p>" + escape(r.boundary) + "</p>");
  return heading(job?.title || r.title, "QuidEdge \\xB7 Client Services \\xB7 " + (job?.status || "Not added"), active ? tag("Position added", "good") : btn("Add this hiring position", "activate-role", "", true)) + panel("Commission-only opportunity", '<p class="commission-lead">No fixed salary</p><p>' + escape(r.compensation) + "</p><p>" + escape(r.important) + '</p><div class="commission-grid">' + r.tiers.map(([rate, range]) => "<div><strong>" + escape(rate) + "</strong><span>" + escape(range) + "</span></div>").join("") + "</div><p>" + escape(r.payment) + '</p><p class="hint">' + escape(r.boundary) + "</p>") + (job ? panel("Saved role requirements", "<p>" + escape(job.brief || "") + "</p>") : "") + panel("Role details", table(["Company", "Location", "Engagement", "Industry"], [[escape(r.company), escape(r.location), escape(r.employment), escape(r.industry)]])) + '<div class="split">' + panel("About QuidEdge", r.about.map((p) => "<p>" + escape(p) + "</p>").join("")) + panel("About the role", r.overview.map((p) => "<p>" + escape(p) + "</p>").join("")) + "</div>" + panel("Key responsibilities", '<ol class="role-list">' + r.responsibilities.map((p) => "<li>" + escape(p) + "</li>").join("") + "</ol>") + panel("Why join QuidEdge?", '<div class="benefit-grid">' + r.benefits.map(([title, text]) => "<article><h3>" + escape(title) + "</h3><p>" + escape(text) + "</p></article>").join("") + "</div>");
}
async function activateRole() {
  if (saving) return;
  saving = true;
  try {
    const saved = await append(defaultRoleRecord(dateSL()));
    ingest([saved]);
    render();
    flash("Client Acquisition & Client Relations position added.");
  } catch (err2) {
    flash(err2.message);
  } finally {
    saving = false;
  }
}
function cooView() {
  queueMicrotask(() => loadMaintenanceStatus());
  const relatedJobs = state.jobs.filter((j) => j.profile === "client-acquisition-v1" || j.id === hiringRole.id);
  const ids = new Set(relatedJobs.map((j) => j.id));
  const candidates = state.candidates.filter((c) => ids.has(c.job_id));
  const active = candidates.filter((c) => !closed.includes(c.stage));
  const due = active.filter((c) => c.due && c.due <= dateSL()).sort((a, b) => a.due.localeCompare(b.due));
  const documents = active.filter((c) => c.documents?.cv !== "Available" || c.documents?.cover !== "Available");
  const terms = active.filter((c) => c.commission_ack !== "Accepted");
  const review = active.filter((c) => ["R1 Review", "R2 Review", "Reference Check", "Offer / Agreement"].includes(c.stage));
  const stats = [["Active candidates", active.length], ["Due / overdue", due.length], ["Documents incomplete", documents.length], ["Terms to confirm", terms.length]];
  const summaries = events.filter((x2) => x2.kind === "summary" && x2.event_date === dateSL());
  return heading(
    "COO recruitment workspace",
    "Client Acquisition & Client Relations \\xB7 Daily priorities and review queue",
    '<div class="toolbar">' + btn("Role & commission terms", "role-view") + btn("+ Add candidate", "candidate", "", true) + "</div>"
  ) + '<div class="coo-stats">' + stats.map(([title, total]) => '<div class="panel"><span>' + escape(title) + "</span><strong>" + total + "</strong></div>").join("") + "</div>" + panel("Today\\u2019s next actions", candidateTable(due)) + '<div class="split">' + panel("Ready for COO review", candidateTable(review)) + panel("Commission acknowledgement", candidateTable(terms, "commission", "Review terms")) + "</div>" + panel("CV & cover letter checklist", documents.length ? table(["Candidate", "CV", "Cover letter", "Action"], documents.map((c) => [
    "<strong>" + escape(c.alias) + "</strong>",
    tag(c.documents?.cv || "Missing", c.documents?.cv === "Available" ? "good" : "warn"),
    tag(c.documents?.cover || "Missing", c.documents?.cover === "Available" ? "good" : "warn"),
    btn("Upload documents", "documents", c.id, true)
  ])) : empty(active.length ? "All active candidates have both application documents." : "No candidates added yet. Upload status will appear here.")) + panel("Daily COO handover", summaries.length ? "<p>" + escape(summaries.at(-1).payload.progress) + "</p><p><strong>Blockers / decisions:</strong> " + escape(summaries.at(-1).payload.blockers || "None recorded") + "</p><p><strong>Next priorities:</strong> " + escape(summaries.at(-1).payload.priorities) + "</p>" : empty("Add today\\u2019s progress, blockers and next priorities."), btn("+ Daily summary", "summary", "", true)) + panel("Storage maintenance", '<p id="maintenance-state">Checking recovery and backup status\\u2026</p>');
}
function showDocuments(candidate) {
  if (!candidate) return;
  const job = state.jobs.find((j) => j.id === candidate.job_id);
  if (job?.profile !== "client-acquisition-v1") {
    flash("Use the Client Acquisition & Client Relations position for this upload workflow.");
    return;
  }
  const stateMarkup = '<div class="statline">' + tag("CV: " + (candidate.documents?.cv || "Missing")) + tag("Cover letter: " + (candidate.documents?.cover || "Missing")) + "</div>";
  show('<div class="section-top"><h2 id="dialog-title">Application documents \\xB7 ' + escape(candidate.alias) + "</h2>" + btn("Close", "close") + "</div>" + stateMarkup + '<p class="public-note">The full name and document contents go to Google Drive. They are not saved to the public candidate record or browser draft.</p><p id="drive-connection" class="hint" role="status">Checking Google Drive connection\\u2026</p><form id="document-entry" data-candidate="' + escape(candidate.id) + '"><div class="form-grid">' + field("private_name", "Candidate\\u2019s full name (private)", { required: true, max: 120, wide: true }) + '<label class="field">CV<input type="file" name="cv" accept=".pdf,.doc,.docx"></label><label class="field">Cover letter<input type="file" name="cover" accept=".pdf,.doc,.docx"></label></div><p class="hint">PDF, DOC or DOCX \\xB7 up to 5 MB per file. New versions are preserved; identical retries reuse the existing file.</p><button class="btn" type="button" data-action="verify-documents" data-id="' + escape(candidate.id) + '">Verify current file availability</button><p id="upload-progress" role="status"></p><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn primary" type="submit" disabled>Upload to Google Drive</button></div></form>');
  const form = dialog.querySelector("#document-entry");
  form.dataset.cvRequest = newId();
  form.dataset.coverRequest = newId();
  fetch(apiBase + "/integrations?candidate_id=" + encodeURIComponent(candidate.id), { cache: "no-store", signal: AbortSignal.timeout(2e4) }).then(async (response) => {
    if (!response.ok) throw new Error("Connection check failed.");
    const status = await response.json();
    if (!form.isConnected) return;
    const text = dialog.querySelector("#drive-connection");
    text.textContent = status.drive_ready ? "Private Drive destination verified. A named folder is created on first upload. Corrected names rename only that folder; original files remain preserved." : "Google Drive is not verified. Ask the owner to check authorization and the private destination folder, then reopen this dialog. Candidate records remain available.";
    form.querySelector("[type=submit]").disabled = !status.drive_ready;
  }).catch(() => {
    if (form.isConnected) dialog.querySelector("#drive-connection").textContent = "Could not check Drive. Close and reopen this panel to retry.";
  });
}
async function saveDocuments(form) {
  if (saving) return;
  const errorBox = form.querySelector(".form-error"), progress = form.querySelector("#upload-progress");
  errorBox.textContent = "";
  const candidate = candidateById(form.dataset.candidate), name = form.elements.private_name.value.trim();
  const tasks = ["cv", "cover"].map((type) => ({ type, file: form.elements[type].files[0] })).filter((t) => t.file);
  if (name.length < 2) {
    errorBox.textContent = "Enter the candidate\\u2019s full name.";
    return;
  }
  if (!tasks.length) {
    errorBox.textContent = "Choose a CV, cover letter, or both.";
    return;
  }
  try {
    for (const task of tasks) await checkDocument(task.file);
  } catch (err2) {
    errorBox.textContent = err2.message;
    return;
  }
  if (saving) return;
  saving = true;
  const controls = dialog.querySelectorAll("button,input");
  for (const el of controls) el.disabled = true;
  try {
    for (const task of tasks) {
      progress.textContent = "Uploading " + (task.type === "cv" ? "CV" : "cover letter") + "\\u2026";
      const result = await uploadDocument(apiBase, candidate, name, task.file, task.type, form.dataset[task.type + "Request"]);
      ingest([result.event]);
      form.elements[task.type].value = "";
      form.dataset[task.type + "Request"] = newId();
    }
    progress.textContent = "Saved to Google Drive. Original files are preserved.";
    form.elements.private_name.value = "";
    render();
    flash("Application documents saved to the candidate\\u2019s private Drive folder.");
  } catch (err2) {
    errorBox.textContent = err2.message;
    progress.textContent = "Completed files remain saved. Retry the remaining selected document.";
  } finally {
    saving = false;
    for (const el of controls) el.disabled = false;
  }
}
async function verifyDocuments(id, control) {
  if (saving) return;
  control.disabled = true;
  try {
    const response = await fetch(apiBase + "/document-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidate_id: id, id: newId() }), signal: AbortSignal.timeout(25e3) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Verification failed.");
    ingest([result.event]);
    dialog.querySelector("#upload-progress").textContent = "Checked now \\xB7 CV: " + result.cv + " \\xB7 Cover letter: " + result.cover + ". These are statuses at this check time.";
    render();
  } catch (err2) {
    flash(err2.message);
  } finally {
    control.disabled = false;
  }
}
async function loadMaintenanceStatus() {
  const target = document.querySelector("#maintenance-state");
  if (!target) return;
  try {
    const response = await fetch(apiBase + "/maintenance", { cache: "no-store" });
    const status = await response.json();
    if (!response.ok) throw Error();
    if (target.isConnected) target.textContent = "Last successful maintenance: " + (status.last_success ? new Date(status.last_success).toLocaleString("en-LK", { timeZone: "Asia/Colombo" }) + " SL" : "Not yet run") + " \\xB7 Private event backup through record " + status.backup_cursor + " \\xB7 Pending document confirmations: " + status.pending_receipts + ". File availability is verified separately.";
  } catch {
    if (target.isConnected) target.textContent = "Maintenance status unavailable. Ask the owner to check the scheduled Worker.";
  }
}
`, "type": "application/javascript; charset=utf-8" }, "/model.js": { "body": `export const stages = ['Sourced','Contacted','Replied','R1 Scheduled','R1 Review','R2 Prep','R2 Scheduled','R2 Review','Reference Check','Offer / Agreement','On Hold','Hired','Rejected','Withdrawn'];
export const closed = ['Hired','Rejected','Withdrawn'];
export const milestones = ['First outreach','Reply received','Follow-up sent','R1 completed','R2 brief sent','R2 completed','Writing task completed','References completed','Offer sent','Agreement / NDA signed','Interview no-show','Interview cancelled','Offer declined','Blocker update','Commission terms reviewed','Candidate details corrected','Document availability checked'];
export const checklistItems = [
  ['terms','Role and payment terms confirmed'],
  ['writing','Writing / practical task reviewed'],
  ['references','References checked'],
  ['offer','Offer accepted'],
  ['agreement','Agreement completed'],
  ['nda','NDA completed']
];
export const dateSL = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'
}).format(date);
export const groupStages = [
  ['Sourced',['Sourced','Contacted','Replied'],'amber'],
  ['Screening',['R1 Scheduled','R1 Review'],'blue'],
  ['Technical',['R2 Prep','R2 Scheduled','R2 Review','Reference Check'],'coral'],
  ['Offer',['Offer / Agreement'],'purple'],
  ['Hired',['Hired'],'green']
];
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
export function validDate(value) {
  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === value;
}
export function stageProblem(payload, candidate, eventDate) {
  if (candidate.job_id==='e2173dde-bc77-409a-96a1-86dcb23841f0' && ['R1 Scheduled','R1 Review','R2 Prep','R2 Scheduled','R2 Review','Reference Check','Offer / Agreement','Hired'].includes(payload.stage) && (candidate.commission_ack!=='Accepted'||!candidate.terms_detail?.trim())) return 'Confirm accepted commission-only terms before advancing this candidate.';
  if (!stages.includes(payload.stage)) return 'Choose a valid stage.';
  if (!String(payload.note || '').trim()) return 'Add the reason for this update.';
  if (!closed.includes(payload.stage)) {
    if (![payload.action,payload.due,payload.owner].every(v=>typeof v==='string' && v.trim())) return 'Set the next action, owner and due date.';
  }
  const slot = payload.stage === 'R1 Scheduled' ? payload.r1 : payload.stage === 'R2 Scheduled' ? payload.r2 : '';
  if (['R1 Scheduled','R2 Scheduled'].includes(payload.stage)) {
    if (!slot) return 'Set the interview date and time in Sri Lanka time.';
    if (slot.slice(0,10) < eventDate) return 'The interview cannot be earlier than the event date.';
  }
  if (payload.stage === 'Hired') {
    const missing = checklistItems.filter(([key]) => !['Complete','Waived'].includes(candidate.checklist[key]));
    if (missing.length) return 'Complete or waive each hiring checklist item before marking Hired.';
    if (!validDate(payload.start_date)) return 'Confirm the start date before marking Hired.';
  }
  return '';
}
export function recordStates(events) {
  const states=new Map();
  for(const event of [...events].sort((a,b)=>a.seq-b.seq)) {
    if(event.kind==='summary' && event.payload.operation && event.payload.target_id)
      states.set(event.payload.target_id,{deleted:event.payload.operation==='delete',revision:event.seq});
  }
  return states;
}
export function visibleEvents(events) {
  const states=recordStates(events);
  const replaced=new Set(events.filter(e=>e.payload.supersedes).map(e=>e.payload.supersedes));
  return events.filter(e=>!e.payload.operation && !states.get(e.id)?.deleted && !replaced.has(e.id));
}
export function project(events) {
  const states=recordStates(events);
  const visible=new Set(visibleEvents(events).map(e=>e.id));
  const jobs = new Map();
  const candidates = new Map();
  for (const event of [...events].sort((a,b) => a.seq - b.seq)) {
    const p = event.payload;
    if(p.operation)continue;
    if(!visible.has(event.id) && !(event.kind==='candidate'||event.kind==='job'&&!p.job_id))continue;
    if(p.supersedes && !visible.has(event.id))continue;
    if (event.kind === 'job') {
      if (p.job_id) {
        const job = jobs.get(p.job_id);
        if (job) Object.assign(job,p,{id:p.job_id,revision:event.seq});
      } else {
        jobs.set(event.id,{status:'Open',headcount:'1',...p,id:event.id,revision:event.seq});
      }
    }
    if (event.kind === 'candidate') {
      candidates.set(event.id, {
        ...p,id:event.id,date:event.event_date,revision:event.seq,
        history:[event],r1:'',r2:'',checklist:{},documents:{cv:'Missing',cover:'Missing'},start_date:''
      });
    }
    const candidate = candidates.get(event.subject_id);
    if (!candidate) continue;
    candidate.history.push(event);
    candidate.revision = event.seq;
    if (event.kind === 'stage') {
      for (const key of ['stage','action','due','owner','blocker','r1','r2','start_date']) {
        if (key in p) candidate[key] = p[key];
      }
    }
    if (event.kind === 'activity') {
      if(p.event==='Candidate details corrected')for(const key of ['alias','source','availability','notice','market'])if(key in p)candidate[key]=p[key];
      if(p.event==='Document availability checked'){candidate.documents_checked_at=event.created_at;for(const type of ['cv','cover'])if(p[type+'_state'])candidate.documents[type]=p[type+'_state'];}
      if (p.event === 'Document stored' && ['cv','cover'].includes(p.document_type)) candidate.documents[p.document_type] = 'Receipt saved';
      if (p.event === 'Commission terms reviewed') { candidate.commission_ack=p.commission_ack; candidate.commission_plan=p.commission_plan;candidate.terms_detail=p.terms_detail||''; }
      if (p.event === 'Hiring checklist updated') {
        for (const [key] of checklistItems) {
          if (key in p) candidate.checklist[key] = p[key];
        }
      }
      const completed = {
        'Writing task completed':['writing'],
        'References completed':['references'],
        'Agreement / NDA signed':['agreement','nda']
      }[p.event] || [];
      for (const key of completed) candidate.checklist[key] = 'Complete';
    }
  }
  for(const job of jobs.values())job.deleted=Boolean(states.get(job.id)?.deleted);
  for(const candidate of candidates.values())candidate.deleted=Boolean(states.get(candidate.id)?.deleted);
  for(const event of events) {
    const revision=states.get(event.id)?.revision;
    if(!revision)continue;
    const candidate=candidates.get(event.subject_id||event.id);
    const job=jobs.get(event.payload.job_id||event.id);
    if(candidate)candidate.revision=Math.max(candidate.revision,revision);
    if(job)job.revision=Math.max(job.revision,revision);
  }
  return {jobs:[...jobs.values()].reverse(),candidates:[...candidates.values()].reverse()};
}
export function attention(candidate, today = dateSL()) {
  if (closed.includes(candidate.stage)) return 'Closed';
  if (candidate.due && candidate.due < today) return 'Overdue';
  if (candidate.blocker || candidate.owner === 'Leadership') return 'Needs decision';
  if (!candidate.action || !candidate.due || !candidate.owner) return 'Missing next step';
  return candidate.due === today ? 'Due today' : 'On track';
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"','""') + '"';
}

export function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes,value => value.toString(16).padStart(2,'0')).join('');
  return hex.slice(0,8) + '-' + hex.slice(8,12) + '-' + hex.slice(12,16) + '-' +
    hex.slice(16,20) + '-' + hex.slice(20);
}

export const roleScorecards={
 acquisition:{R1:['Acquisition evidence','Client communication','Commercial judgment','Confidentiality & terms'],R2:['Prospect research','Discovery & proposals','Objection handling','Client relations & follow-up']},
 social:{R1:['Campaign ownership & results','English & client communication','AI judgment','Confidentiality'],R2:['Brand audit evidence','Creative strategy','Client role-play','Team responsibility']}
};
export function scorecardFor(job){return roleScorecards[job?.profile==='client-acquisition-v1'?'acquisition':'social'];}
export function privacyProblem(value){
 return /[\\w.+%-]+@[\\w.-]+\\.[a-z]{2,}|https?:\\/\\/|www\\./i.test(value)||/(?:\\+\\d[\\d() .-]{7,}\\d)|(?:\\b0\\d{9}\\b)|(?:\\b\\d{3}[- .]\\d{3}[- .]\\d{4}\\b)|(?:\\b(?:phone|mobile|tel|contact|whatsapp)\\s*:?\\s*\\d[\\d() .-]{6,}\\d)/i.test(value);
}

// Include recoverable changes to bookings so restoring a record never revives an old email.
export function interviewRevision(events,candidate){
 const stages=new Set(events.filter(e=>e.kind==='stage'&&e.subject_id===candidate.id).map(e=>e.id));
 return events.reduce((seq,e)=>stages.has(e.id)||e.kind==='summary'&&['delete','restore'].includes(e.payload.operation)&&(e.payload.target_id===candidate.id||stages.has(e.payload.target_id))?Math.max(seq,e.seq):seq,0);
}
`, "type": "application/javascript; charset=utf-8" }, "/store.js": { "body": "import {config} from './config.js?v=5ea8864332e1';\nimport {validEvent} from './record-utils.js';\n\nexport const apiBase = config.eventsUrl.replace(/\\/events$/,'');\nexport const connected = Boolean(config.eventsUrl);\nasync function request(path = '', options = {}) {\n  let response;\n  try {\n    response = await fetch(config.eventsUrl + path, {\n      cache:'no-store',signal:AbortSignal.timeout(20000),...options\n    });\n  } catch {\n    throw new Error('Connection interrupted. Your draft is kept. Retry to confirm the same save.');\n  }\n  let body;\n  try {body=await response.json();} catch {\n    throw new Error('The server response could not be confirmed. Your draft is kept; retry the same save.');\n  }\n  if (!response.ok) {\n    const error = new Error(body?.error || 'Storage request failed. Try again.');\n    error.status = response.status;\n    throw error;\n  }\n  return body;\n}\nexport async function loadEvents(after = 0,filters = {}) {\n  const events = [];\n  let cursor = after;\n  for (;;) {\n    const batch = await request('?'+new URLSearchParams({...filters,after:String(cursor)}));\n    if (!Array.isArray(batch)) throw new Error('The server returned an invalid event list.');\n    if (!batch.length) return events;\n    let previous=cursor;const ids=new Set();\n    if (batch.some(event => {\n      if(!validEvent(event)||event.seq<=previous||ids.has(event.id))return true;\n      previous=event.seq;ids.add(event.id);return false;\n    })) {\n      throw new Error('The event cursor is invalid. Refresh to retry.');\n    }\n    events.push(...batch);\n    cursor = batch.at(-1).seq;\n    if (batch.length < 500) return events;\n  }\n}\nexport async function append(event) {\n  const saved=await request('',{\n    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event)\n  });\n  if(!validEvent(saved)||saved.id!==event.id||saved.kind!==event.kind||saved.subject_id!==event.subject_id) {\n    throw new Error('The saved record was not confirmed. Your draft is kept; retry the same save.');\n  }\n  return saved;\n}\n\n// Advance only after reading the ordered server feed, never from a local save receipt.\nexport function createEventReader() {\n let cursor=0,started=false;\n return async()=>{\n  if(!started){\n   const response=await fetch(apiBase+'/bootstrap',{cache:'no-store',signal:AbortSignal.timeout(20000)});\n   if(!response.ok){const events=await loadEvents(0);cursor=events.at(-1)?.seq||0;started=true;return events;}\n   const snapshot=await response.json();\n   if(!Number.isSafeInteger(snapshot.cursor)||snapshot.cursor<0||!Array.isArray(snapshot.events)||snapshot.events.some(e=>!validEvent(e)||e.seq>snapshot.cursor))throw Error('Invalid recruitment snapshot. Retry sync.');\n   cursor=snapshot.cursor;started=true;return snapshot.events;\n  }\n  const incoming=await loadEvents(cursor);if(incoming.length)cursor=incoming.at(-1).seq;return incoming;\n };\n}\n", "type": "application/javascript; charset=utf-8" }, "/config.js": { "body": "export const config = { eventsUrl: '/api/events' };\n", "type": "application/javascript; charset=utf-8" }, "/guide.js": { "body": 'export default [["R1", "Open", 2, "Explain the role, call structure and next round.", null], ["R1", "Experience", 2, "Walk me through your last two roles. For each, what did you personally own on social media, and who else was on the team?", null], ["R1", "Experience", 3, "Pick the campaign you are most proud of. What was the goal, what did you personally do, and what was the result?", null], ["R1", "Experience", 1, "How many of your clients or audiences were outside Sri Lanka, and in which countries?", null], ["R1", "English and client communication", 4, "Live reply. \u201CThis is Sarah from Bloom Skincare in the UK. Honestly, I\u2019m disappointed. We have paid for 2 months and our Instagram engagement has dropped. My friend\u2019s brand posts every day and gets far more likes. I want us posting daily starting tomorrow.\u201D", "Listen for acknowledgement, clarifying questions and a concrete next step."], ["R1", "English and client communication", 3, "Tell me about a client who was genuinely unhappy with your work. What were the first words you said to them, and how did it end?", null], ["R1", "AI use", 2, "Which AI tools do you use in your work, and what exactly do you use each one for?", null], ["R1", "AI use", 2, "Tell me about the last time AI gave you something you could not use. What was wrong with it, and what did you do?", null], ["R1", "AI use", 1, "If a post created with AI help causes a problem for the client, whose responsibility is it?", null], ["R1", "Confidentiality and NDA", 2, "In your own words, what does an NDA actually cover, and when does it stop applying?", "Listen for checking the specific agreement and its terms."], ["R1", "Confidentiality and NDA", 2, "A prospect asks, \u201CWhich other brands do you work with? Can you show me what you did for them?\u201D What do you say?", null], ["R1", "Logistics", 4, "Confirm notice period, earliest start, salary expectation range, hours and time zone flexibility, internet, backup power, quiet call space and ongoing commitments.", "For commission-based openings, confirm the approved terms and candidate understanding."], ["R1", "Questions and close", 2, "Take candidate questions and confirm when they\u2019ll hear back.", "R1 total is 30 minutes."], ["R2", "Open", 3, "Explain the hour and confirm the later writing task is without AI.", "Writing task is tracked separately."], ["R2", "Brand audit presentation", 10, "Candidate presents six slides without interruption.", null], ["R2", "Audit defence", 2, "Why did you choose these three weaknesses over everything else you saw?", null], ["R2", "Audit defence", 2, "What did AI suggest that you rejected, and why did you reject it?", null], ["R2", "Audit defence", 2, "The client says there is no budget for your creative idea. What is your plan B?", null], ["R2", "Audit defence", 2, "If you could do only one of your three improvements first, which one, and what would you measure?", null], ["R2", "Audit defence", 2, "Follow-up and note-taking buffer.", "Fills the 10-minute block."], ["R2", "Client role-play", 2, "\u201CWe sell handmade candles in Australia. We need to go viral. Can you guarantee that?\u201D", null], ["R2", "Client role-play", 2, "\u201COur sales have been flat, so we just want more followers.\u201D", null], ["R2", "Client role-play", 2, "\u201CWe want it to feel more premium, but not too serious.\u201D", null], ["R2", "Client role-play", 2, "\u201CI heard you work with [a competitor]. What is their ad budget?\u201D", "Confidentiality check."], ["R2", "Client role-play", 2, "Interrupt mid-sentence with a new concern.", null], ["R2", "Client role-play", 3, "\u201CHonestly, what do you think is wrong with our brand right now?\u201D", null], ["R2", "Client role-play", 7, "Role-play buffer and follow-up.", "Includes the original 2-minute buffer and 5 unallocated minutes."], ["R2", "Team behaviours", 10, "Pick four from the question bank below.", null], ["R2", "Their questions", 5, "Take candidate questions.", null], ["R2", "Close and next steps", 2, "Confirm reference contacts and decision timeline.", "R2 total is 60 minutes."], ["Bank", "Team behaviours", null, "Describe the best manager you have worked with. What made it work?", null], ["Bank", "Team behaviours", null, "Tell me about the harshest feedback you have received, and what you did with it.", null], ["Bank", "Team behaviours", null, "You finish your tasks early on a quiet day. What do you do?", null], ["Bank", "Team behaviours", null, "A teammate is struggling with a client and it is not your account. What do you do?", null], ["Bank", "Team behaviours", null, "Why a small, growing company rather than a large agency?", null], ["Bank", "Team behaviours", null, "What does \u201Cbeing responsible for your work\u201D mean to you?", null], ["Scoring", "Evidence", null, "1 = clear gap. 2 = partial. 3 = meets the requirement. 4 = strong. 5 = consistently strong evidence. Leave untested criteria blank.", "Use the same core prompts and criteria for everyone in the same role."], ["Setup", "Before outreach", null, "Confirm the open role, approved terms and interview criteria with leadership. Explain approved commission terms early when applicable.", "If hiring Client Acquisition & Client Relations, adapt the social media audit to a role-relevant exercise before using it."], ["Workflow", "Stage updates", null, "After each round, save the scorecard and recommendation. Set the candidate\u2019s stage, next action, owner and due date. Log the event.", "Keep candidate contact details and scorecards in the shared hiring file with restricted access."], ["Workflow", "Final decision", null, "Record the decision and reason. Track references, candidate communication and agreement/NDA milestones as applicable.", "Record who approved any exception in the candidate note."]];\n', "type": "application/javascript; charset=utf-8" }, "/role.js": { "body": "export const hiringRole = {\n  id:'e2173dde-bc77-409a-96a1-86dcb23841f0',\n  title:'Client Acquisition & Client Relations Specialist',\n  company:'QuidEdge',\n  location:'Remote | Work From Anywhere',\n  employment:'Independent Contractor | Commission-Based only',\n  industry:'Personal Branding | Business Branding | Content Creation',\n  compensation:'100% commission-based. No fixed salary. 10%, 20% or 30% recurring monthly commission on eligible acquired client contracts, subject to the agreed terms.',\n  important:'Only candidates genuinely comfortable with a commission-only compensation structure should apply. Candidates must understand and accept the agreed terms before progressing.',\n  about:[\n    'At QuidEdge, we believe great brands are built through meaningful relationships, creative thinking, and strategies that deliver real business value.',\n    'We are a dedicated team of professionals specialising in personal branding, business branding, content creation, social media management, and business development consulting.',\n    'We work with founders, entrepreneurs, creators, and businesses to help them strengthen their market presence, communicate their value, and build brands that people genuinely connect with.',\n    'We are not interested in simply selling services. We believe in understanding businesses, solving real problems, and building long-term partnerships.',\n    'As we continue expanding internationally, we are looking for passionate and ambitious individuals to join our team as Client Acquisition & Client Relations Specialists.'\n  ],\n  overview:[\n    'This is not a traditional sales position. Successful client acquisition starts with trust, genuine conversations, and understanding what a business actually needs.',\n    'Identify potential clients, build professional relationships, introduce QuidEdge\u2019s solutions, and guide prospects through the acquisition process.',\n    'Maintain strong client relationships and ensure a positive experience throughout their journey with us.'\n  ],\n  responsibilities:[\n    'Identify and research potential clients, including founders, entrepreneurs, creators, and business decision-makers.',\n    'Connect with qualified prospects through LinkedIn, email, professional networks, and other appropriate outreach channels.',\n    'Build genuine relationships instead of relying on generic or aggressive sales pitches.',\n    'Understand prospective clients\u2019 business challenges, branding needs, goals, and growth opportunities.',\n    'Present QuidEdge\u2019s services professionally and communicate how our team can deliver value.',\n    'Conduct discovery conversations, handle enquiries, and coordinate proposals with our internal team.',\n    'Manage the client acquisition journey from initial outreach to successful agreement.',\n    'Maintain accurate records of prospect communications, follow-ups, and client interactions.',\n    'Build and maintain positive, long-term relationships with acquired clients.',\n    'Collaborate with our leadership, creative, and operations teams to ensure smooth client onboarding and communication.',\n    'Represent QuidEdge with professionalism, integrity, and confidentiality.'\n  ],\n  benefits:[\n    ['Work From Anywhere','Enjoy the flexibility of working remotely while connecting with businesses and professionals internationally.'],\n    ['Build Long-Term Income Opportunities','Develop a portfolio of clients that can generate recurring commissions rather than relying solely on one-time sales.'],\n    ['A Supportive Team Culture','People should feel valued, respected, and supported. Collaboration, open communication, and continuous development are central to how we work.'],\n    ['Professional Growth','Gain practical exposure to international business development, client negotiations, brand strategy, and relationship management.'],\n    ['Your Ideas Matter','We encourage initiative and fresh perspectives. Contribute to improving our client acquisition strategies and growing as a team.']\n  ],\n  tiers:[['10%','AUD 300\u20131,000 / month'],['20%','AUD 1,000\u20134,999 / month'],['30%','AUD 5,000+ / month']],\n  payment:'Commission is uncapped and continues monthly while the client stays active and paying. Paid monthly in AUD after QuidEdge receives the client\u2019s payment, subject to the agreed contract.',\n  boundary:'The supplied tier ranges overlap at AUD 1,000. Confirm the applicable rate in the candidate\u2019s agreement; this dashboard does not calculate or promise a rate at that boundary.',\n  screening:[\n    ['Experience','Walk through your last two roles. What outreach, discovery, closing and ongoing client relationship work did you personally own?'],\n    ['Evidence','Describe a client you acquired. How did you identify them, qualify the need, build trust and reach an agreement? What was the commercial result?'],\n    ['International communication','Which client markets have you worked with? Respond live to a prospect who asks for a guarantee of sales or viral results.'],\n    ['Commission understanding','Explain the commission-only arrangement in your own words. Is there a fixed salary? When are commissions paid? What terms must you confirm?'],\n    ['Client relations','Tell us about an unhappy client. What did you say first, how did you handle it and what changed?'],\n    ['Confidentiality','A prospect asks for a competitor\u2019s budget and private results. How would you respond?'],\n    ['AI judgment','Which tools support your research and outreach? Give an example you rejected or verified before using.'],\n    ['Remote readiness','Confirm working hours, market time zones, notice period, internet, backup power, call space and other commitments.']\n  ]\n};\n\nexport function defaultRoleRecord(date) {\n  return {id:hiringRole.id,kind:'job',subject_id:null,event_date:date,payload:{\n    title:hiringRole.title,department:'Client Services',location:'Remote \xB7 International',\n    employment:'Commission-based',headcount:'1',status:'Open',profile:'client-acquisition-v1',\n    brief:'Independent contractor. No fixed salary. 10% / 20% / 30% recurring commission on eligible acquired contracts under agreed terms. Own prospect research, outreach, discovery, proposals, closing, onboarding and ongoing client relations. Confirm terms and international communication readiness.'\n  }};\n}\n", "type": "application/javascript; charset=utf-8" }, "/documents.js": { "body": "import {validateDocumentBytes} from './binary.js';\nimport {validEvent} from './record-utils.js';\nexport const maxDocumentBytes = 5 * 1024 * 1024;\nexport async function checkDocument(file) {\n  if (!file || !file.size) throw new Error('Choose a non-empty document.');\n  if (file.size > maxDocumentBytes) throw new Error('Each document must be 5 MB or smaller.');\n  const ext = file.name.split('.').at(-1).toLowerCase();\n  const bytes = new Uint8Array(await file.arrayBuffer());\n  validateDocumentBytes(bytes,ext);\n  const pdf=ext==='pdf',doc=ext==='doc';\n  return {extension:ext,mime:pdf?'application/pdf':doc?'application/msword':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};\n}\nexport async function uploadDocument(apiBase,candidate,fullName,file,type,requestId) {\n  const metadata = await checkDocument(file);\n  const buffer = new Uint8Array(await file.arrayBuffer());\n  let binary='';\n  for (let i=0;i<buffer.length;i+=32768) binary+=String.fromCharCode(...buffer.subarray(i,i+32768));\n  let response;\n  try {\n    response=await fetch(apiBase+'/documents',{method:'POST',headers:{'Content-Type':'application/json'},\n      body:JSON.stringify({id:requestId,candidate_id:candidate.id,name:fullName,document_type:type,\n        extension:metadata.extension,data:btoa(binary)}),signal:AbortSignal.timeout(90000)});\n  } catch {throw new Error('Upload interrupted. Retry with the same file. The candidate record is already saved.');}\n  const result=await response.json().catch(()=>({}));\n  if (!response.ok) throw new Error(result?.error || 'Document upload failed. Retry with the same file.');\n  if(result?.uploaded!==true || !validEvent(result.event) || result.event.id!==requestId ||\n    result.event.subject_id!==candidate.id || result.event.kind!=='activity' ||\n    result.event.payload.event!=='Document stored' || result.event.payload.document_type!==type) {\n    throw new Error('Drive did not confirm the saved document. Keep the file selected and retry.');\n  }\n  return result;\n}\n", "type": "application/javascript; charset=utf-8" }, "/record-utils.js": { "body": "const kinds = new Set(['job','candidate','stage','activity','summary','score']);\nconst idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;\nexport function validEvent(event) {\n  return Boolean(event && typeof event==='object' && Number.isSafeInteger(event.seq) && event.seq>0 &&\n    typeof event.id==='string' && idPattern.test(event.id) && kinds.has(event.kind) &&\n    (event.subject_id===null || typeof event.subject_id==='string' && idPattern.test(event.subject_id)) &&\n    typeof event.event_date==='string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(event.event_date) &&\n    event.payload && typeof event.payload==='object' && !Array.isArray(event.payload));\n}\nexport function validDraft(value) {\n  return Boolean(value && typeof value==='object' && !Array.isArray(value) &&\n    ['job','candidate','stage','activity','score','checklist','commission','summary','correction','recordaction'].includes(value.kind) &&\n    typeof value.id==='string' && (!value.id || idPattern.test(value.id)) &&\n    typeof value.request==='string' && idPattern.test(value.request) &&\n    Number.isSafeInteger(value.revision) && value.revision>=0 && value.values &&\n    typeof value.values==='object' && !Array.isArray(value.values) &&\n    Object.values(value.values).every(v=>typeof v==='string') &&\n    (value.kind!=='score' || ['R1','R2'].includes(value.values.round)) &&\n    (!value.pending || typeof value.pending==='object' && value.pending.id===value.request && kinds.has(value.pending.kind)));\n}\nexport function foldCalendarLine(line) {\n  const encoder=new TextEncoder();const lines=[];let current='',size=0;\n  for(const char of line){const bytes=encoder.encode(char).length;\n    if(size+bytes>75){lines.push(current);current=' ';size=1;}\n    current+=char;size+=bytes;\n  }\n  lines.push(current);return lines.join('\\r\\n');\n}\n\n// One draft per form and candidate; switching tools must not block or erase work.\nexport function mergeDrafts(drafts,value,kind=value?.kind,id=value?.id) {\n  const remaining=drafts.filter(d=>d.kind!==kind || d.id!==id);\n  return value ? [...remaining,value] : remaining;\n}\n", "type": "application/javascript; charset=utf-8" } };
export {
  api_default as default
};
