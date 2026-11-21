// 日本語ノート — application logic
(function(){
  "use strict";
  var STORAGE_KEY = "jpNotebookEntries_v1";


  // ===== JLPT N5 completion pack (aligned to 大家的日本語 L9-25 + N5 word groups) =====

  var CAT_LABEL = {vocab:"語", phrase:"句", grammar:"文"};
  var CAT_TITLE = {vocab:"Vocabulary", phrase:"Phrase", grammar:"Grammar"};

  var seedById = {};
  SEED.forEach(function(e){ seedById[e.id] = e; });

  // ---------- Storage: only the user's own additions & deletions are saved,
  // so seed content can keep improving between versions ----------
  var USER_KEY = "jpNotebookUser_v2";
  var LEGACY_KEY = "jpNotebookEntries_v1";
  function loadUserState(){
    try {
      var raw = localStorage.getItem(USER_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.added) && Array.isArray(s.deletedSeedIds)) { if (!s.overrides || typeof s.overrides !== "object") s.overrides = {}; return s; }
      }
    } catch (e) {}
    try {
      var old = localStorage.getItem(LEGACY_KEY);
      if (old) {
        var arr = JSON.parse(old);
        if (Array.isArray(arr)) {
          var added = arr.filter(function(en){ return en && typeof en.id === "string" && en.id.indexOf("u-") === 0; });
          return {added: added, deletedSeedIds: [], overrides: {}};
        }
      }
    } catch (e) {}
    return {added: [], deletedSeedIds: [], overrides: {}};
  }
  var userState = loadUserState();
  function saveUserState(){
    try { localStorage.setItem(USER_KEY, JSON.stringify(userState)); }
    catch (e) { console.warn("Could not save to this browser's storage:", e); }
  }
  saveUserState();

  function allEntries(){
    var del = {};
    userState.deletedSeedIds.forEach(function(id){ del[id] = true; });
    return SEED.filter(function(e){ return !del[e.id]; }).map(function(e){
      var o = userState.overrides[e.id];
      if (!o) return e;
      var c = {};
      for (var k in e) c[k] = e[k];
      for (var k2 in o) c[k2] = o[k2];
      return c;
    }).concat(userState.added);
  }
  var entries = allEntries();
  function refreshEntries(){ entries = allEntries(); }
  function entriesById(id){
    for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return entries[i];
    return null;
  }
  function deleteEntry(id){
    if (seedById[id]) {
      if (userState.deletedSeedIds.indexOf(id) === -1) userState.deletedSeedIds.push(id);
    } else {
      userState.added = userState.added.filter(function(e){ return e.id !== id; });
    }
    saveUserState();
    refreshEntries();
  }

  var activeTab = "vocab";
  var searchText = "";
  var tagFilter = "";
  var pageIdx = 0;
  var PAGE_KEY = "jpNotebookPageSize";
  function loadPageSize(){ try { var v = parseInt(localStorage.getItem(PAGE_KEY), 10); return [10,20,50].indexOf(v) !== -1 ? v : 20; } catch (e) { return 20; } }
  var pageSize = loadPageSize();
  function savePageSize(){ try { localStorage.setItem(PAGE_KEY, String(pageSize)); } catch (e) {} }

  var content = document.getElementById("content");
  var tabsNav = document.getElementById("tabs");

  function activateTab(btn){
    if (!btn) return;
    activeTab = btn.getAttribute("data-tab");
    searchText = "";
    tagFilter = "";
    numDrill = null;
    qpDrill = null;
    verbDrill = null;
    partDrill = null;
    listenView = "home";
    qrDrill = null;
    convDrill = null;
    stopSpeech();
    closeDetail();
    Array.prototype.forEach.call(tabsNav.querySelectorAll("button"), function(b){
      b.classList.toggle("active", b === btn);
    });
    render();
  }
  tabsNav.addEventListener("click", function(e){ activateTab(e.target.closest("button[data-tab]")); });
  tabsNav.style.gridTemplateColumns = "repeat(" + Math.ceil(tabsNav.querySelectorAll("button[data-tab]").length / 2) + ", minmax(0, 1fr))";
  function stepTab(dir){
    var bs = Array.prototype.slice.call(tabsNav.querySelectorAll("button[data-tab]")), i = 0;
    bs.forEach(function(b, k){ if (b.classList.contains("active")) i = k; });
    activateTab(bs[(i + dir + bs.length) % bs.length]);
  }
  document.getElementById("tabPrev").addEventListener("click", function(){ stepTab(-1); });
  document.getElementById("tabNext").addEventListener("click", function(){ stepTab(1); });
  document.getElementById("tabFirst").addEventListener("click", function(){ var bs = tabsNav.querySelectorAll("button[data-tab]"); activateTab(bs[0]); });
  document.getElementById("tabLast").addEventListener("click", function(){ var bs = tabsNav.querySelectorAll("button[data-tab]"); activateTab(bs[bs.length - 1]); });

  function escapeHtml(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function kataToHira(s){
    return String(s || "").replace(/[\u30A1-\u30F6]/g, function(c){ return String.fromCharCode(c.charCodeAt(0) - 0x60); });
  }
  function norm(s){ return kataToHira(String(s || "").toLowerCase()); }
  function matches(e, q){
    var hay = (e.jp || "") + " " + (e.reading || "") + " " + (e.meaning || "") + " " + (e.lesson || "") + " " + (e.notes || "");
    return norm(hay).indexOf(q) !== -1;
  }

  // ---------- Audio (browser ja-JP speech) ----------
  var jaVoice = null;
  function pickVoice(){
    if (!window.speechSynthesis) return;
    var vs = speechSynthesis.getVoices() || [];
    for (var i = 0; i < vs.length; i++) {
      if ((vs[i].lang || "").toLowerCase().indexOf("ja") === 0) { jaVoice = vs[i]; return; }
    }
  }
  if (window.speechSynthesis) {
    pickVoice();
    if (typeof speechSynthesis.onvoiceschanged !== "undefined") speechSynthesis.onvoiceschanged = pickVoice;
  }
  var audioWarned = false;
  function speak(text){
    if (!text) return;
    if (!window.speechSynthesis) {
      if (!audioWarned) { alert("This browser does not support speech. Try Chrome, Safari or Edge."); audioWarned = true; }
      return;
    }
    try {
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      if (jaVoice) u.voice = jaVoice;
      u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  function speakTextFor(e){
    var r = String(e.reading || "").split("／")[0].split("/")[0].trim();
    var base = (/^[\u3040-\u30FF\u30FC\sー、。〜～・]+$/.test(r) && r) ? r : e.jp;
    return String(base).replace(/(^|\n)\s*[AB]：/g, "$1").replace(/（な）/g, "").replace(/[〜～\[\]／]/g, " ").replace(/[（）()]/g, " ").trim() || e.jp;
  }
  function speakerBtn(text, cls){
    return '<button class="spk' + (cls ? " " + cls : "") + '" data-say="' + escapeHtml(text) + '" title="Listen" aria-label="Listen">🔊</button>';
  }
  function wireSpeakers(root){
    (root || content).querySelectorAll("[data-say]").forEach(function(b){
      if (b._wired) return; b._wired = true;
      b.addEventListener("click", function(ev){
        ev.stopPropagation();
        speak(b.getAttribute("data-say"));
      });
    });
  }

  // ---------- Lists with tag chips, search & clickable rows ----------
  function tagsOf(e){
    return String(e.lesson || "").split("|").map(function(t){ return t.trim(); }).filter(Boolean);
  }
  function chipsHtml(e){
    var ts = tagsOf(e);
    if (!ts.length) return '<span class="seal-chip">—</span>';
    return ts.map(function(t){ return '<span class="seal-chip" data-lesson="' + escapeHtml(t) + '" title="Filter by this tag">' + escapeHtml(t) + '</span>'; }).join("");
  }
  function lessonSortKey(tag){
    var m = /^L(\d+)/.exec(tag);
    if (m) return [0, parseInt(m[1], 10), tag];
    return [1, 0, tag];
  }
  function tagCompare(a, b){
    var ka = lessonSortKey(a), kb = lessonSortKey(b);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return ka[2] < kb[2] ? -1 : 1;
  }
  function allTags(){
    var set = {};
    entries.forEach(function(e){ tagsOf(e).forEach(function(t){ set[t] = true; }); });
    return Object.keys(set).sort(tagCompare);
  }
  function tagsFor(category){
    var set = {};
    entries.forEach(function(e){ if (e.category === category) tagsOf(e).forEach(function(t){ set[t] = true; }); });
    var tags = Object.keys(set);
    tags.sort(function(a, b){
      var ka = lessonSortKey(a), kb = lessonSortKey(b);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      return ka[2] < kb[2] ? -1 : 1;
    });
    return tags;
  }

  var COLOUR_HEX = {"白":"#f6f3ea","黒":"#1f1f1f","赤":"#c0392b","青":"#2b63c9","黄":"#e6c229","緑":"#3a8f4a","茶":"#8b5a2b","紫":"#7d4fa8","ピンク":"#e78fb3","オレンジ":"#f28c28"};
  function colourSwatch(jp){
    var hex = null;
    Object.keys(COLOUR_HEX).forEach(function(k){ if (!hex && jp.indexOf(k) === 0) hex = COLOUR_HEX[k]; });
    return hex ? '<span class="swatch" style="background:' + hex + '"></span>' : "";
  }

  // ---------- Direction / position map ----------
  function directionMapHtml(){
    return '<div class="map-box">' +
    '<svg viewBox="0 0 720 360" class="pos-map" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Position words map">' +
      '<rect x="0" y="250" width="480" height="40" class="mp-road"/><text x="8" y="275" class="mp-txt">道</text>' +
      '<g class="mp-g" data-k="g-park"><rect x="160" y="30" width="120" height="60" rx="4" class="mp-park"/><text x="220" y="66" class="mp-txt mp-c">公園</text><text x="220" y="22" class="mp-tag mp-c">後ろ</text></g>' +
      '<g class="mp-g" data-k="g-super"><rect x="30" y="130" width="110" height="100" rx="3" class="mp-bld"/><text x="85" y="185" class="mp-txt mp-c">スーパー</text><text x="85" y="122" class="mp-tag mp-c">左</text><text x="85" y="245" class="mp-tag mp-c">隣</text></g>' +
      '<g class="mp-g" data-k="g-bank"><rect x="160" y="110" width="120" height="120" rx="3" class="mp-bld mp-bank"/><text x="220" y="175" class="mp-txt mp-c mp-big">銀行</text></g>' +
      '<g class="mp-g" data-k="g-cafe"><rect x="300" y="130" width="80" height="100" rx="3" class="mp-bld"/><text x="340" y="185" class="mp-txt mp-c">喫茶店</text><text x="340" y="122" class="mp-tag mp-c">右</text><text x="340" y="245" class="mp-tag mp-c">間</text></g>' +
      '<g class="mp-g" data-k="g-book"><rect x="400" y="130" width="70" height="100" rx="3" class="mp-bld"/><text x="435" y="185" class="mp-txt mp-c">本屋</text></g>' +
      '<g class="mp-g" data-k="g-post"><rect x="213" y="234" width="14" height="16" rx="2" class="mp-post"/><text x="248" y="246" class="mp-tag">前</text></g>' +
      '<g class="mp-g" data-k="g-hosp"><rect x="160" y="300" width="120" height="50" rx="3" class="mp-bld"/><text x="220" y="330" class="mp-txt mp-c">病院</text><text x="220" y="298" class="mp-tag mp-c">向かい</text></g>' +
      '<g class="mp-g" data-k="g-sta"><rect x="390" y="300" width="80" height="50" rx="3" class="mp-bld"/><text x="430" y="330" class="mp-txt mp-c">駅</text><text x="430" y="298" class="mp-tag mp-c">近く</text></g>' +
      '<line x1="495" y1="20" x2="495" y2="340" class="mp-div"/>' +
      '<rect x="510" y="150" width="190" height="12" rx="2" class="mp-desk"/><rect x="520" y="162" width="10" height="80" class="mp-desk"/><rect x="680" y="162" width="10" height="80" class="mp-desk"/><text x="705" y="160" class="mp-txt">机</text>' +
      '<g class="mp-g" data-k="g-bookd"><rect x="565" y="128" width="44" height="22" rx="2" class="mp-bld"/><text x="587" y="144" class="mp-txt mp-c">本</text><text x="587" y="118" class="mp-tag mp-c">上</text></g>' +
      '<g class="mp-g" data-k="g-cat"><ellipse cx="605" cy="212" rx="20" ry="14" class="mp-ani"/><text x="605" y="217" class="mp-txt mp-c">猫</text><text x="605" y="244" class="mp-tag mp-c">下</text></g>' +
      '<g class="mp-g" data-k="g-ball"><rect x="640" y="275" width="60" height="55" rx="3" class="mp-bld"/><text x="670" y="345" class="mp-txt mp-c">箱</text><circle cx="670" cy="306" r="11" class="mp-ball"/><text x="670" y="268" class="mp-tag mp-c">中</text></g>' +
      '<g class="mp-g" data-k="g-dog"><ellipse cx="585" cy="305" rx="22" ry="15" class="mp-ani"/><text x="585" y="310" class="mp-txt mp-c">犬</text><text x="585" y="338" class="mp-tag mp-c">外</text></g>' +
    '</svg>' +
    '<div class="map-cap" id="mapCap">點地圖上的建築物或動物，看例句並聽發音。<span class="detail-sub">[名詞]の＋方位詞＋に＋あります／います</span></div></div>';
  }
  function wireDirectionMap(root){
    var groups = root.querySelectorAll(".mp-g");
    groups.forEach(function(g){
      g.addEventListener("click", function(){
        groups.forEach(function(x){ x.classList.remove("active"); });
        g.classList.add("active");
        var k = g.getAttribute("data-k");
        var it = null;
        MAP_ITEMS.forEach(function(m){ if (m[0] === k) it = m; });
        var cap = root.querySelector("#mapCap");
        if (!it) { if (cap) cap.innerHTML = '<span class="t-jp">銀行</span> ＝ 基準點。點旁邊的東西看它們「在銀行的哪裡」。'; return; }
        if (cap) cap.innerHTML = '<span class="t-jp">' + escapeHtml(it[1]) + '</span> ' + speakerBtn(it[3]) + '<div class="t-zh">' + escapeHtml(it[2]) + '</div>';
        wireSpeakers(root);
        speak(it[3]);
      });
    });
  }

  var ANT_MAP = null;
  function antBase(j){ return String(j || "").replace(/（な）/g, ""); }
  function antList(e){
    if (!e || e.category !== "vocab") return [];
    if (!ANT_MAP) {
      ANT_MAP = {};
      ANT_PAIRS.forEach(function(p){ (ANT_MAP[p[0]] = ANT_MAP[p[0]] || []).push(p[1]); (ANT_MAP[p[1]] = ANT_MAP[p[1]] || []).push(p[0]); });
    }
    return ANT_MAP[antBase(e.jp)] || [];
  }
  function findVocabBase(b){
    for (var i = 0; i < entries.length; i++) if (entries[i].category === "vocab" && antBase(entries[i].jp) === b) return entries[i];
    return null;
  }
  function antLabel(b){ var e = findVocabBase(b); return e ? e.jp : b; }

  function rowHtml(e, compact){
    var canSpeak = e.category !== "grammar";
    return '<div class="entry-row' + (compact ? ' compact' : '') + '" data-open="' + e.id + '">' +
      '<div class="row-head"><span class="cat-mono" title="' + CAT_TITLE[e.category] + '">' + CAT_LABEL[e.category] + '</span></div>' +
      '<div class="entry-main">' +
        '<div class="jp-line">' + (e.lesson === "N5 Colour" ? colourSwatch(e.jp) : "") + escapeHtml(e.jp) + (canSpeak ? speakerBtn(speakTextFor(e)) : "") + '</div>' +
        (e.reading ? '<div class="reading">' + escapeHtml(e.reading) + '</div>' : '') +
        '<div class="meaning">' + escapeHtml(e.meaning) + '</div>' +
        (antList(e).length ? '<div class="ant">⇄ ' + escapeHtml(antList(e).map(antLabel).join("・")) + '</div>' : '') +
        (e.notes && !compact ? '<div class="notes">' + escapeHtml(e.notes) + '</div>' : '') +
      '</div>' +
      '<div class="row-side">' +
        chipsHtml(e) +
        (compact ? '' : '<button class="del-btn" data-del="' + e.id + '" title="Delete">✕</button>') +
      '</div>' +
    '</div>';
  }

  function renderList(category){
    pageIdx = 0;
    var tags = tagsFor(category);
    var side = '<aside class="side-filter"><p class="side-title">分類 Filter</p><div class="tagbar"><button class="tag-chip' + (tagFilter === "" ? " active" : "") + '" data-tag="">All</button>';
    tags.forEach(function(t){
      side += '<button class="tag-chip' + (tagFilter === t ? " active" : "") + '" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>';
    });
    side += '</div></aside>';
    var main = '<div class="toolbar"><input type="search" id="searchBox" autocomplete="off" placeholder="Search Japanese, kana, or meaning…" value="' + escapeHtml(searchText) + '"></div><div id="listResults"></div>';
    content.innerHTML = '<div class="list-layout"><div class="list-main">' + main + '</div>' + side + '</div>';

    renderResults(category);

    // The search box itself is never re-rendered while typing, so IME composition
    // (e.g. Microsoft IME on Windows) is not interrupted mid-character.
    var searchBox = document.getElementById("searchBox");
    var composing = false;
    searchBox.addEventListener("compositionstart", function(){ composing = true; });
    searchBox.addEventListener("compositionend", function(){
      composing = false;
      searchText = searchBox.value;
      pageIdx = 0;
      renderResults(category);
    });
    searchBox.addEventListener("input", function(ev){
      if (composing || ev.isComposing) return;
      searchText = searchBox.value;
      pageIdx = 0;
      renderResults(category);
    });
    content.querySelectorAll(".tag-chip").forEach(function(c){
      c.addEventListener("click", function(){
        tagFilter = c.getAttribute("data-tag") || "";
        renderList(category);
      });
    });
    updateFooterCount();
  }

  function renderResults(category){
    var box = document.getElementById("listResults");
    if (!box) return;
    var q = norm(searchText.trim());
    var list = entries.filter(function(e){ return e.category === category; });
    if (tagFilter) list = list.filter(function(e){ return tagsOf(e).indexOf(tagFilter) !== -1; });
    if (q) list = list.filter(function(e){ return matches(e, q); });

    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / pageSize));
    if (pageIdx >= pages) pageIdx = pages - 1;
    if (pageIdx < 0) pageIdx = 0;
    var start = pageIdx * pageSize;
    var pageItems = list.slice(start, start + pageSize);
    function pagerHtml(){
      return '<div class="pager"><label class="pager-size-wrap">Show <select class="pager-size">' +
        [10,20,50].map(function(n){ return '<option value="' + n + '"' + (pageSize === n ? ' selected' : '') + '>' + n + '</option>'; }).join("") +
        '</select></label><span class="pager-nav"><button class="btn pager-prev"' + (pageIdx === 0 ? ' disabled' : '') + '>‹ Prev</button><span class="pager-pos">' + (pageIdx + 1) + ' / ' + pages + '</span><button class="btn pager-next"' + (pageIdx >= pages - 1 ? ' disabled' : '') + '>Next ›</button></span></div>';
    }
    var html = '<p class="count-note">' + total + ' ' + (total === 1 ? "entry" : "entries") + (tagFilter ? ' · ' + escapeHtml(tagFilter) : '') + (total > pageSize ? ' · showing ' + (start + 1) + '–' + Math.min(start + pageSize, total) : '') + ' — tap a word for examples &amp; conjugation</p>';
    if (!total) {
      html += '<div class="empty-state">Nothing matches here. Try "All", clear the search, or tap + to add.</div>';
    } else {
      if (total > 10) html += pagerHtml();
      html += '<div class="entry-list">';
      pageItems.forEach(function(e){ html += rowHtml(e, false); });
      html += '</div>';
      if (total > pageSize) html += pagerHtml();
    }
    if (q) {
      var TAB_NAME = {vocab: "語彙 Vocabulary", phrase: "フレーズ Phrases", grammar: "文法 Grammar"};
      ["vocab", "phrase", "grammar"].forEach(function(cat){
        if (cat === category) return;
        var others = entries.filter(function(e){ return e.category === cat && matches(e, q); }).slice(0, 8);
        if (others.length) {
          html += '<p class="count-note xfind">Also found in <strong>' + TAB_NAME[cat] + '</strong> (' + others.length + '):</p><div class="entry-list">';
          others.forEach(function(e){ html += rowHtml(e, true); });
          html += '</div>';
        }
      });
    }
    if (q) {
      var vhits = VERB_LIST.filter(function(v){ return verbHay(v).indexOf(q) !== -1; }).slice(0, 6);
      if (vhits.length) html += '<p class="count-note xfind">Also found in <strong>活用 Verbs</strong> (' + vhits.length + '): ' + vhits.map(function(v){ return escapeHtml(v[0]); }).join("・") + ' <button class="btn" id="goVerbs">Open in Verbs →</button></p>';
    }
    if (category === "vocab" && tagFilter === "N5 Direction") html = directionMapHtml() + html;
    box.innerHTML = html;
    if (category === "vocab" && tagFilter === "N5 Direction") wireDirectionMap(box);
    var gv = document.getElementById("goVerbs");
    if (gv) gv.addEventListener("click", function(){ verbSearch = searchText; verbGroup = 0; verbLesson = ""; activateTab(tabsNav.querySelector('button[data-tab="verbs"]')); });
    box.querySelectorAll(".pager-size").forEach(function(sel){
      sel.addEventListener("change", function(){ pageSize = parseInt(sel.value, 10); savePageSize(); pageIdx = 0; renderResults(category); });
    });
    box.querySelectorAll(".pager-prev").forEach(function(b){
      b.addEventListener("click", function(){ if (pageIdx > 0) { pageIdx--; renderResults(category); box.scrollIntoView({block: "start", behavior: "smooth"}); } });
    });
    box.querySelectorAll(".pager-next").forEach(function(b){
      b.addEventListener("click", function(){ pageIdx++; renderResults(category); box.scrollIntoView({block: "start", behavior: "smooth"}); });
    });

    box.querySelectorAll("[data-del]").forEach(function(btn){
      btn.addEventListener("click", function(ev){
        ev.stopPropagation();
        var id = btn.getAttribute("data-del");
        if (confirm("Delete this entry?")) {
          deleteEntry(id);
          renderResults(category);
        }
      });
    });
    box.querySelectorAll(".seal-chip[data-lesson]").forEach(function(chip){
      chip.addEventListener("click", function(ev){
        ev.stopPropagation();
        var t = chip.getAttribute("data-lesson") || "";
        var row = chip.closest(".entry-row");
        var owner = row ? entriesById(row.getAttribute("data-open")) : null;
        if (owner && owner.category === category) { tagFilter = t; searchText = ""; }
        else { searchText = t; }
        renderList(category);
      });
    });
    box.querySelectorAll("[data-open]").forEach(function(row){
      row.addEventListener("click", function(){
        var e = entriesById(row.getAttribute("data-open"));
        if (e) openDetail(e);
      });
    });
    wireSpeakers(box);
    updateFooterCount();
  }

  // ---------- Dictionary detail view ----------
  function baseWordOf(e){
    return String(e.jp).replace(/（な）/g, "").split("／")[0].trim();
  }
  function conjugationFor(e){
    if (e.category !== "vocab") return null;
    var jp = e.jp, notes = e.notes || "";
    if (/[〜～\[]/.test(jp)) return null;
    if (jp === "いい／良い") {
      return {kind: "い形容詞（不規則）", rows: [
        ["現在", "いいです"], ["否定", "よくないです"], ["過去", "よかったです"], ["過去否定", "よくなかったです"], ["副詞形", "よく"]
      ]};
    }
    var isNa = /な-adjective|な形容詞/.test(notes) || /（な）/.test(jp);
    var isI = !isNa && /い-adjective|い形容詞/.test(notes);
    var r = String(e.reading || "").split("／")[0].trim();
    var rOk = /^[\u3040-\u30FF\u30FCー]+$/.test(r);
    if (isNa) {
      var b = baseWordOf(e), br = rOk ? r : b;
      return {kind: "な形容詞", rows: [
        ["現在", b + "です", br + "です"],
        ["否定", b + "じゃありません", br + "じゃありません"],
        ["過去", b + "でした", br + "でした"],
        ["過去否定", b + "じゃありませんでした", br + "じゃありませんでした"],
        ["接名詞", b + "な＋名詞", br + "な"]
      ]};
    }
    if (isI && /い$/.test(jp)) {
      var stem = jp.slice(0, -1);
      var rstem = (rOk && /い$/.test(r)) ? r.slice(0, -1) : stem;
      return {kind: "い形容詞", rows: [
        ["現在", stem + "いです", rstem + "いです"],
        ["否定", stem + "くないです", rstem + "くないです"],
        ["過去", stem + "かったです", rstem + "かったです"],
        ["過去否定", stem + "くなかったです", rstem + "くなかったです"],
        ["副詞形", stem + "く", rstem + "く"]
      ]};
    }
    if (/ます$/.test(jp) && !/ています$/.test(jp)) {
      var vb = jp.slice(0, -2);
      var vr = (rOk && /ます$/.test(r)) ? r.slice(0, -2) : vb;
      return {kind: "動詞（ます形變化）", rows: [
        ["現在", vb + "ます", vr + "ます"],
        ["否定", vb + "ません", vr + "ません"],
        ["過去", vb + "ました", vr + "ました"],
        ["過去否定", vb + "ませんでした", vr + "ませんでした"],
        ["提議", vb + "ましょう", vr + "ましょう"]
      ]};
    }
    return null;
  }
  function crossRefs(e){
    var base = baseWordOf(e);
    if (!base) return [];
    if (base.length < 2 && !/[\u4E00-\u9FFF]/.test(base)) return [];
    var refs = [];
    for (var i = 0; i < entries.length; i++) {
      var o = entries[i];
      if (o.id === e.id) continue;
      if ((o.jp && o.jp.indexOf(base) !== -1) || (o.notes && o.notes.indexOf(base) !== -1)) refs.push(o);
      if (refs.length >= 6) break;
    }
    return refs;
  }
  var detailOverlay = null;
  function openDetail(e){
    closeDetail();
    var canSpeak = e.category !== "grammar";
    var conj = conjugationFor(e);
    var refs = crossRefs(e);
    var base = baseWordOf(e);
    var html = '<div class="detail">' +
      '<div class="detail-top"><button class="btn" id="detailClose">← Back</button><span class="detail-actions">' +
      '<button class="btn" id="detailEdit">✎ Edit</button>' +
      '<a class="jisho-link" href="https://jisho.org/search/' + encodeURIComponent(base) + '" target="_blank" rel="noopener">Jisho 辞書 ↗</a></span></div>' +
      '<div class="detail-word' + (e.jp.length > 24 ? ' long' : '') + '">' + escapeHtml(e.jp) + (canSpeak ? speakerBtn(speakTextFor(e), "big") : "") + '</div>' +
      (e.reading ? '<div class="detail-reading">' + escapeHtml(e.reading) + '</div>' : '') +
      '<div class="detail-meaning">' + escapeHtml(e.meaning) + '</div>' +
      '<div class="detail-meta">' + chipsHtml(e) + '<span class="cat-mono">' + CAT_LABEL[e.category] + '</span></div>' +
      (e.notes ? '<div class="detail-notes">' + escapeHtml(e.notes) + '</div>' : '');
    var ants = antList(e);
    if (ants.length) {
      html += '<h3 class="detail-h">反義詞 <span class="detail-sub">opposite</span></h3><div class="entry-list">';
      ants.forEach(function(a){ var ae = findVocabBase(a); html += ae ? rowHtml(ae, true) : '<p class="num-note">' + escapeHtml(a) + '</p>'; });
      html += '</div>';
    }
    if (conj) {
      html += '<h3 class="detail-h">活用 <span class="detail-sub">' + escapeHtml(conj.kind) + '</span></h3><table class="conj-table">';
      conj.rows.forEach(function(row){
        var spoken = row[2] || row[1];
        html += '<tr><th>' + escapeHtml(row[0]) + '</th><td>' + escapeHtml(row[1]) + '</td><td class="conj-spk">' + speakerBtn(spoken) + '</td></tr>';
      });
      html += '</table>';
    }
    if (refs.length) {
      html += '<h3 class="detail-h">在筆記中的用例</h3><div class="entry-list">';
      refs.forEach(function(o){ html += rowHtml(o, true); });
      html += '</div>';
    }
    html += '</div>';

    detailOverlay = document.createElement("div");
    detailOverlay.className = "detail-overlay";
    detailOverlay.innerHTML = html;
    document.body.appendChild(detailOverlay);
    document.getElementById("detailClose").addEventListener("click", closeDetail);
    document.getElementById("detailEdit").addEventListener("click", function(){ closeDetail(); openEditModal(e); });
    detailOverlay.addEventListener("click", function(ev){ if (ev.target === detailOverlay) closeDetail(); });
    detailOverlay.querySelectorAll("[data-open]").forEach(function(row){
      row.addEventListener("click", function(){
        var o = entriesById(row.getAttribute("data-open"));
        if (o) openDetail(o);
      });
    });
    wireSpeakers(detailOverlay);
  }
  function closeDetail(){
    if (detailOverlay && detailOverlay.parentNode) detailOverlay.parentNode.removeChild(detailOverlay);
    detailOverlay = null;
  }

  // ---------- Numbers & counters (数) ----------
  var numDrill = null;
  function numPool(){
    var pool = [];
    NUM_SECTIONS.forEach(function(s){
      s.rows.forEach(function(r){
        var item = {written: r[0], reading: r[1], irr: !!r[2], section: s.title};
        pool.push(item);
        if (item.irr) pool.push(item);
      });
    });
    return pool;
  }
  function startNumDrill(){
    var pool = numPool();
    var qs = [];
    var used = {};
    var guard = 0;
    while (qs.length < 10 && guard++ < 500) {
      var it = pool[Math.floor(Math.random() * pool.length)];
      var key = it.written + "|" + it.reading;
      if (used[key]) continue;
      used[key] = true;
      var sect = null;
      for (var i = 0; i < NUM_SECTIONS.length; i++) if (NUM_SECTIONS[i].title === it.section) sect = NUM_SECTIONS[i];
      var others = sect.rows.map(function(r){ return r[1]; }).filter(function(x){ return x !== it.reading; });
      others = shuffleArr(others).slice(0, 3);
      while (others.length < 3) others.push(pool[Math.floor(Math.random() * pool.length)].reading);
      qs.push({item: it, options: shuffleArr([it.reading].concat(others))});
    }
    numDrill = {questions: qs, idx: 0, score: 0, answered: false, missed: []};
  }
  function renderNumbers(){
    if (numDrill) { renderNumDrill(); return; }
    var html = '<p class="count-note">數字・量詞讀音總表——<span class="irr-mark">紅色＝不規則讀音</span>（考試最愛考的地方）。</p>' +
      '<div class="start-row" style="padding:4px 0 12px; text-align:left;"><button class="btn primary" id="numDrillBtn">開始練習（10題）</button></div>';
    var side = '<aside class="side-filter"><p class="side-title">跳到 Jump</p><div class="tagbar">';
    NUM_SECTIONS.forEach(function(s, i){
      side += '<button class="tag-chip" data-jump="ns' + i + '">' + escapeHtml(s.chip) + '</button>';
    });
    side += '</div></aside>';
    NUM_SECTIONS.forEach(function(s, i){
      html += '<h3 class="detail-h" id="ns' + i + '">' + escapeHtml(s.title) + '</h3>';
      if (s.note) html += '<p class="num-note">' + escapeHtml(s.note) + '</p>';
      html += '<div class="num-grid">';
      s.rows.forEach(function(r){
        html += '<div class="num-cell"><span class="num-written">' + escapeHtml(r[0]) + '</span><span class="num-reading' + (r[2] ? ' irr' : '') + '">' + escapeHtml(r[1]) + '</span>' + speakerBtn(String(r[1]).split("／")[0].replace(/[（）]/g, "")) + '</div>';
      });
      html += '</div>';
    });
    content.innerHTML = '<div class="list-layout"><div class="list-main">' + html + '</div>' + side + '</div>';
    document.getElementById("numDrillBtn").addEventListener("click", function(){ startNumDrill(); renderNumbers(); });
    content.querySelectorAll("[data-jump]").forEach(function(c){
      c.addEventListener("click", function(){
        var el = document.getElementById(c.getAttribute("data-jump"));
        if (el) el.scrollIntoView({behavior: "smooth", block: "start"});
      });
    });
    wireSpeakers();
    updateFooterCount();
  }
  function renderNumDrill(){
    var d = numDrill;
    if (d.idx >= d.questions.length) {
      var html = '<div class="quiz-summary"><div class="big-score">' + d.score + ' / ' + d.questions.length + '</div>';
      if (d.missed.length) {
        html += '<p class="count-note">要再看一次：</p><ul>';
        d.missed.forEach(function(m){ html += '<li><strong>' + escapeHtml(m.written) + '</strong> ＝ <span class="irr-mark">' + escapeHtml(m.reading) + '</span> <span class="detail-sub">' + escapeHtml(m.section) + '</span> ' + speakerBtn(m.reading.split("／")[0].replace(/[（）]/g, "")) + '</li>'; });
        html += '</ul>';
      } else {
        html += '<p class="count-note">全對——完璧です！</p>';
      }
      html += '<div class="start-row"><button class="btn primary" id="numAgain">再來一次</button> <button class="btn" id="numBack">回到總表</button></div></div>';
      content.innerHTML = html;
      document.getElementById("numAgain").addEventListener("click", function(){ startNumDrill(); renderNumbers(); });
      document.getElementById("numBack").addEventListener("click", function(){ numDrill = null; renderNumbers(); });
      wireSpeakers();
      return;
    }
    var q = d.questions[d.idx];
    var html2 = '<div class="quiz-feedback-row"><span class="quiz-q">第 ' + (d.idx + 1) + ' 題／共 ' + d.questions.length + ' 題 · ' + escapeHtml(q.item.section) + '</span><span class="quiz-score-line">Score: ' + d.score + '</span></div>';
    html2 += '<div class="quiz-jp">' + escapeHtml(q.item.written) + '</div>';
    html2 += '<p class="count-note">怎麼唸？</p>';
    html2 += '<div class="quiz-options">';
    q.options.forEach(function(opt){
      html2 += '<button class="quiz-opt" data-r="' + escapeHtml(opt) + '">' + escapeHtml(opt) + '<span class="quiz-mark"></span></button>';
    });
    html2 += '</div><div class="start-row" id="numNextWrap" style="display:none;"><button class="btn primary" id="numNext">下一題</button></div>';
    content.innerHTML = html2;
    var btns = content.querySelectorAll(".quiz-opt");
    btns.forEach(function(b){
      b.addEventListener("click", function(){
        if (d.answered) return;
        d.answered = true;
        var chosen = b.getAttribute("data-r");
        var ok = chosen === q.item.reading;
        if (ok) d.score++; else d.missed.push(q.item);
        btns.forEach(function(b2){
          b2.disabled = true;
          var mk = b2.querySelector(".quiz-mark");
          if (b2.getAttribute("data-r") === q.item.reading) { b2.classList.add("correct"); mk.textContent = "◯"; }
          else if (b2.getAttribute("data-r") === chosen) { b2.classList.add("wrong"); mk.textContent = "✗"; }
        });
        speak(q.item.reading.split("／")[0].replace(/[（）]/g, ""));
        document.getElementById("numNextWrap").style.display = "block";
      });
    });
    document.getElementById("numNext").addEventListener("click", function(){
      d.idx++;
      d.answered = false;
      renderNumDrill();
    });
  }

  // ---------- Listening practice (聴解) ----------
  var listenView = "home";
  var qrDrill = null, convDrill = null;
  var listenSlow = false;

  function stopSpeech(){ if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) {} } }
  function speakSeq(parts){
    if (!window.speechSynthesis) {
      if (!audioWarned) { alert("This browser does not support speech. Try Chrome, Safari or Edge."); audioWarned = true; }
      return;
    }
    try {
      speechSynthesis.cancel();
      var rate = listenSlow ? 0.72 : 0.95;
      parts.forEach(function(p){
        var u = new SpeechSynthesisUtterance(p.t);
        u.lang = "ja-JP";
        if (jaVoice) u.voice = jaVoice;
        u.rate = rate;
        u.pitch = p.p || 1;
        speechSynthesis.speak(u);
      });
    } catch (e) {}
  }
  function spkPitch(spk){ return spk === "女" ? 1.25 : 0.75; }
  function qrPlayParts(q){
    var parts = [{t: q.item.q, p: 1}];
    for (var i = 0; i < q.shuffled.length; i++) parts.push({t: (i + 1) + "番。" + q.shuffled[i], p: 0.85});
    return parts;
  }
  function convPlayParts(item){
    var parts = item.lines.map(function(l){ return {t: l[1], p: spkPitch(l[0])}; });
    parts.push({t: item.q, p: 1});
    return parts;
  }
  function buildListenDrill(items){
    var qs = shuffleArr(items).map(function(it){
      return {item: it, shuffled: shuffleArr(it.opts.slice()), correct: it.opts[0]};
    });
    return {questions: qs, idx: 0, score: 0, answered: false, missed: []};
  }
  function renderListening(){
    if (listenView === "qr" && qrDrill) { renderListenDrill(qrDrill, "qr"); return; }
    if (listenView === "conv" && convDrill) { renderListenDrill(convDrill, "conv"); return; }
    stopSpeech();
    var html = '<p class="count-note">JLPT 聴解形式的聽力練習——先聽、再作答，答完才看逐字稿＋中譯。使用裝置內建日語語音（離線可用）。</p>';
    html += '<label class="listen-slow"><input type="checkbox" id="slowToggle"' + (listenSlow ? ' checked' : '') + '> 慢速播放（0.7x）</label>';
    html += '<div class="pack-grid">' +
      '<button class="pack-card" id="packQR"><span class="pack-jp">即時応答</span><span class="pack-en">Quick Response · ' + LISTEN_QR.length + ' 題</span><span class="pack-desc">聽一句話，從三個「用聽的」回應中選出正確的——選項不會先顯示文字，跟真實考試一樣。</span></button>' +
      '<button class="pack-card" id="packConv"><span class="pack-jp">会話</span><span class="pack-en">Conversations · ' + LISTEN_CONV.length + ' 題</span><span class="pack-desc">聽一段兩人對話（男女聲音不同），回答 JLPT 式問題，答完可逐句重播＋中譯。</span></button>' +
    '</div>';
    html += '<div class="pack-grid"><button class="pack-card" id="packQP"><span class="pack-jp">設問パターン</span><span class="pack-en">Question patterns · 過去問</span><span class="pack-desc">聽力常見問句已移到「設問」分頁：依考試題型整理，附中文翻譯和練習。</span></button></div>';
    html += '<h3 class="detail-h">真人語音資源</h3><div class="native-links">' +
      '<a href="https://youtube.com/playlist?list=PLkGU7DnOLgRMl-h4NxxrGbK-UdZHIXzKQ" target="_blank" rel="noopener">▶ The Nihongo Nook — N5 聴解 Practice Tests（59部影片）</a>' +
      '<a href="https://www.jlpt.jp/e/samples/sample09.html" target="_blank" rel="noopener">▶ JLPT 官方 N5 樣題＋聽力音檔（免費）</a>' +
    '</div>';
    content.innerHTML = html;
    document.getElementById("slowToggle").addEventListener("change", function(ev){ listenSlow = ev.target.checked; });
    document.getElementById("packQR").addEventListener("click", function(){ qrDrill = buildListenDrill(LISTEN_QR); listenView = "qr"; renderListening(); });
    document.getElementById("packConv").addEventListener("click", function(){ convDrill = buildListenDrill(LISTEN_CONV); listenView = "conv"; renderListening(); });
    document.getElementById("packQP").addEventListener("click", function(){ qpFilter = "聴解12"; activateTab(tabsNav.querySelector('button[data-tab="patterns"]')); });
    updateFooterCount();
  }
  // ---------- 設問 Question patterns (past papers, merged with the old common-questions list) ----------
  var qpFilter = "", qpDrill = null;
  function qpSpeakable(t){ return !/[［＿★（）〜／…]/.test(t); }
  function qpAudio(t){ return String(t).replace(/（→[^）]*）/g, "").replace(/（[^）]*）/g, "").replace(/[→＝⇄]/g, "、").replace(/[［］＿★]/g, ""); }
  function qpSrc(src){ return src ? '<span class="src-chip">過去問 ' + src.split(" ").map(function(y){ return "20" + y; }).join("・") + '</span>' : '<span class="src-chip soft">常見</span>'; }
  function qpGroups(){ return QP_GROUPS.filter(function(g){ return !qpFilter || g.sec === qpFilter; }); }
  function renderPatterns(){
    if (qpDrill) { renderQPDrill(); return; }
    stopSpeech();
    var side = '<aside class="side-filter"><p class="side-title">題型 Section</p><div class="tagbar"><button class="tag-chip' + (qpFilter === "" ? " active" : "") + '" data-qs="">All</button>' +
      QP_SECS.map(function(x){ return '<button class="tag-chip' + (qpFilter === x[0] ? " active" : "") + '" data-qs="' + x[0] + '">' + escapeHtml(x[1]) + '</button>'; }).join("") + '</div></aside>';
    var gs = qpGroups(), nP = 0, nV = 0;
    gs.forEach(function(g){ nP += g.pats.length; g.pats.forEach(function(p){ nV += p[2].length; }); });
    var main = '<p class="count-note">過去問（2009・2012・2018）的問題整理成句型：［　］是可以替換的部分。' + nP + ' 個句型、' + nV + ' 個例句。點例句可以聽。</p>' +
      '<div class="listen-controls"><button class="btn primary" id="qpDrillBtn">聽問句，選意思（10題）</button><label class="listen-slow"><input type="checkbox" id="slowToggle"' + (listenSlow ? ' checked' : '') + '> 慢速</label></div>';
    gs.forEach(function(g){
      var secName = QP_SECS.filter(function(x){ return x[0] === g.sec; })[0][1];
      main += '<div class="p-card"><div class="p-head"><span class="qp-title">' + escapeHtml(g.title) + '</span><span class="seal-chip static">' + escapeHtml(secName) + '</span></div><p class="num-note">' + escapeHtml(g.tip) + '</p>';
      g.pats.forEach(function(p){
        main += '<div class="qp-pat"><div class="qp-tpl">' + escapeHtml(p[0]) + (qpSpeakable(p[0]) ? ' ' + speakerBtn(p[0]) : '') + '</div><div class="qp-zh">' + escapeHtml(p[1]) + ' ' + qpSrc(p[3]) + '</div>';
        if (p[4]) main += '<div class="qp-note">提示：' + escapeHtml(p[4]) + '</div>';
        if (p[2].length) {
          main += '<div class="transcript">';
          p[2].forEach(function(v){ main += '<button class="t-line" data-t="' + escapeHtml(qpAudio(v[0])) + '"><span class="t-jp">' + escapeHtml(v[0]) + '</span></button><p class="t-zh">' + escapeHtml(v[1]) + '</p>'; });
          main += '</div>';
        }
        main += '</div>';
      });
      main += '</div>';
    });
    content.innerHTML = '<div class="list-layout"><div class="list-main">' + main + '</div>' + side + '</div>';
    content.querySelectorAll("[data-qs]").forEach(function(c){ c.addEventListener("click", function(){ qpFilter = c.getAttribute("data-qs") || ""; renderPatterns(); }); });
    document.getElementById("qpDrillBtn").addEventListener("click", function(){ startQPDrill(); renderPatterns(); });
    document.getElementById("slowToggle").addEventListener("change", function(ev){ listenSlow = ev.target.checked; });
    content.querySelectorAll(".t-line").forEach(function(tl){ tl.addEventListener("click", function(){ speakSeq([{t: tl.getAttribute("data-t"), p: 1}]); }); });
    wireSpeakers();
    updateFooterCount();
  }
  function qpPool(groups){
    var pool = [];
    groups.forEach(function(g){ g.pats.forEach(function(p){
      if (qpSpeakable(p[0]) && p[1]) pool.push([p[0], p[1]]);
      p[2].forEach(function(v){ if (v[1] && !/[→＝]/.test(v[0])) pool.push([v[0], v[1]]); });
    }); });
    return pool;
  }
  function startQPDrill(){
    var pool = qpPool(qpGroups());
    if (pool.length < 6) pool = qpPool(QP_GROUPS);
    var seen = {};
    pool = pool.filter(function(it){ if (seen[it[0]]) return false; seen[it[0]] = true; return true; });
    var qs = shuffleArr(pool).slice(0, 10).map(function(it){
      var ds = [], g = 0;
      while (ds.length < 3 && g++ < 120) { var o = pick(pool)[1]; if (o !== it[1] && ds.indexOf(o) === -1) ds.push(o); }
      return {jp: it[0], zh: it[1], options: shuffleArr([it[1]].concat(ds))};
    });
    qpDrill = {questions: qs, idx: 0, score: 0, answered: false, missed: []};
  }
  function renderQPDrill(){
    var d = qpDrill;
    if (d.idx >= d.questions.length) {
      stopSpeech();
      var html = '<div class="quiz-summary"><div class="big-score">' + d.score + ' / ' + d.questions.length + '</div>';
      if (d.missed.length) {
        html += '<p class="count-note">要再聽一次：</p><ul>';
        d.missed.forEach(function(m){ html += '<li><strong>' + escapeHtml(m.jp) + '</strong> — ' + escapeHtml(m.zh) + '</li>'; });
        html += '</ul>';
      } else { html += '<p class="count-note">全對——完璧です！</p>'; }
      html += '<div class="start-row"><button class="btn primary" id="qpAgain">再來一次</button> <button class="btn" id="qpList">回到句型表</button></div></div>';
      content.innerHTML = html;
      document.getElementById("qpAgain").addEventListener("click", function(){ startQPDrill(); renderPatterns(); });
      document.getElementById("qpList").addEventListener("click", function(){ qpDrill = null; renderPatterns(); });
      return;
    }
    var q = d.questions[d.idx];
    var h = '<div class="quiz-feedback-row"><span class="quiz-q">設問 · 第 ' + (d.idx + 1) + ' 題／共 ' + d.questions.length + ' 題</span><span class="quiz-score-line">Score: ' + d.score + '</span></div>' +
      '<div class="listen-controls"><button class="btn primary" id="qpPlay">▶ 再播放</button><label class="listen-slow"><input type="checkbox" id="slowToggle"' + (listenSlow ? ' checked' : '') + '> 慢速</label></div>' +
      '<p class="count-note">這句在問什麼？（先聽，不看字）</p><div class="quiz-options">';
    q.options.forEach(function(opt, i){ h += '<button class="quiz-opt" data-i="' + i + '">' + escapeHtml(opt) + '<span class="quiz-mark"></span></button>'; });
    h += '</div><div id="qpReveal"></div><div class="start-row" id="qpNextWrap" style="display:none;"><button class="btn primary" id="qpNext">下一題</button></div>';
    content.innerHTML = h;
    var parts = [{t: qpAudio(q.jp), p: 1}];
    document.getElementById("qpPlay").addEventListener("click", function(){ speakSeq(parts); });
    document.getElementById("slowToggle").addEventListener("change", function(ev){ listenSlow = ev.target.checked; });
    speakSeq(parts);
    var btns = content.querySelectorAll(".quiz-opt");
    btns.forEach(function(b){
      b.addEventListener("click", function(){
        if (d.answered) return;
        d.answered = true;
        var chosen = q.options[parseInt(b.getAttribute("data-i"), 10)];
        if (chosen === q.zh) d.score++; else d.missed.push(q);
        btns.forEach(function(b2){
          b2.disabled = true;
          var o2 = q.options[parseInt(b2.getAttribute("data-i"), 10)], mk = b2.querySelector(".quiz-mark");
          if (o2 === q.zh) { b2.classList.add("correct"); mk.textContent = "◯"; }
          else if (b2 === b) { b2.classList.add("wrong"); mk.textContent = "✗"; }
        });
        document.getElementById("qpReveal").innerHTML = '<p class="num-note"><span class="t-jp">' + escapeHtml(q.jp) + '</span></p>';
        document.getElementById("qpNextWrap").style.display = "block";
      });
    });
    document.getElementById("qpNext").addEventListener("click", function(){ d.idx++; d.answered = false; stopSpeech(); renderQPDrill(); });
  }

  function renderListenDrill(d, kind){
    if (d.idx >= d.questions.length) {
      stopSpeech();
      var html = '<div class="quiz-summary"><div class="big-score">' + d.score + ' / ' + d.questions.length + '</div>';
      if (d.missed.length) {
        html += '<p class="count-note">要再聽一次：</p><ul>';
        d.missed.forEach(function(m){ html += '<li><strong>' + escapeHtml(m.item.q) + '</strong> — ' + escapeHtml(m.correct) + '</li>'; });
        html += '</ul>';
      } else {
        html += '<p class="count-note">全對——完璧です！</p>';
      }
      html += '<div class="start-row"><button class="btn primary" id="lAgain">再來一次</button> <button class="btn" id="lBack">回到聴解</button></div></div>';
      content.innerHTML = html;
      document.getElementById("lAgain").addEventListener("click", function(){
        if (kind === "qr") qrDrill = buildListenDrill(LISTEN_QR); else convDrill = buildListenDrill(LISTEN_CONV);
        renderListening();
      });
      document.getElementById("lBack").addEventListener("click", function(){ listenView = "home"; qrDrill = null; convDrill = null; renderListening(); });
      return;
    }
    var q = d.questions[d.idx];
    var html2 = '<div class="quiz-feedback-row"><span class="quiz-q">' + (kind === "qr" ? "即時応答" : "会話") + ' · 第 ' + (d.idx + 1) + ' 題／共 ' + d.questions.length + ' 題</span><span class="quiz-score-line">Score: ' + d.score + '</span></div>';
    html2 += '<div class="listen-controls"><button class="btn primary" id="playBtn">▶ 再播放</button><label class="listen-slow"><input type="checkbox" id="slowToggle"' + (listenSlow ? ' checked' : '') + '> 慢速</label></div>';
    if (kind === "qr") {
      html2 += '<p class="count-note">聽完後選出正確的回應（選項用聽的，先不看字！）</p><div class="quiz-options qr-opts">';
      q.shuffled.forEach(function(opt, i){
        html2 += '<button class="quiz-opt" data-r="' + escapeHtml(opt) + '"><span class="qr-num">' + (i + 1) + '番</span><span class="qr-text">' + escapeHtml(opt) + '</span><span class="quiz-mark"></span></button>';
      });
      html2 += '</div>';
    } else {
      html2 += '<div class="listen-q">' + escapeHtml(q.item.q) + '</div>';
      html2 += '<div class="quiz-options">';
      q.shuffled.forEach(function(opt){
        html2 += '<button class="quiz-opt" data-r="' + escapeHtml(opt) + '">' + escapeHtml(opt) + '<span class="quiz-mark"></span></button>';
      });
      html2 += '</div>';
    }
    html2 += '<div id="transcriptWrap"></div>';
    html2 += '<div class="start-row" id="lNextWrap" style="display:none;"><button class="btn primary" id="lNext">下一題</button></div>';
    content.innerHTML = html2;

    var playParts = kind === "qr" ? qrPlayParts(q) : convPlayParts(q.item);
    document.getElementById("playBtn").addEventListener("click", function(){ speakSeq(playParts); });
    document.getElementById("slowToggle").addEventListener("change", function(ev){ listenSlow = ev.target.checked; });
    speakSeq(playParts);

    var btns = content.querySelectorAll(".quiz-opt");
    btns.forEach(function(b){
      b.addEventListener("click", function(){
        if (d.answered) return;
        d.answered = true;
        stopSpeech();
        var chosen = b.getAttribute("data-r");
        var ok = chosen === q.correct;
        if (ok) d.score++; else d.missed.push(q);
        btns.forEach(function(b2){
          b2.disabled = true;
          b2.classList.add("revealed");
          var mk = b2.querySelector(".quiz-mark");
          if (b2.getAttribute("data-r") === q.correct) { b2.classList.add("correct"); mk.textContent = "◯"; }
          else if (b2.getAttribute("data-r") === chosen) { b2.classList.add("wrong"); mk.textContent = "✗"; }
        });
        var tw = document.getElementById("transcriptWrap");
        var t = '<h3 class="detail-h">逐字稿・中譯 <span class="detail-sub">點任一句可重播</span></h3><div class="transcript">';
        if (kind === "qr") {
          t += '<button class="t-line" data-t="' + escapeHtml(q.item.q) + '" data-p="1"><span class="t-jp">' + escapeHtml(q.item.q) + '</span></button>';
          t += '<p class="t-zh">' + escapeHtml(q.item.zh) + '</p>';
        } else {
          q.item.lines.forEach(function(l){
            t += '<button class="t-line" data-t="' + escapeHtml(l[1]) + '" data-p="' + spkPitch(l[0]) + '"><span class="t-spk">' + escapeHtml(l[0]) + '</span><span class="t-jp">' + escapeHtml(l[1]) + '</span></button>';
            t += '<p class="t-zh">' + escapeHtml(l[2]) + '</p>';
          });
          t += '<p class="t-zh t-q">' + escapeHtml(q.item.qzh) + '</p>';
        }
        t += '</div>';
        tw.innerHTML = t;
        tw.querySelectorAll(".t-line").forEach(function(tl){
          tl.addEventListener("click", function(){
            speakSeq([{t: tl.getAttribute("data-t"), p: parseFloat(tl.getAttribute("data-p")) || 1}]);
          });
        });
        document.getElementById("lNextWrap").style.display = "block";
      });
    });
    document.getElementById("lNext").addEventListener("click", function(){
      d.idx++;
      d.answered = false;
      stopSpeech();
      renderListening();
    });
  }

  // ---------- Verb transformation recap (活用) ----------
  var GODAN = {"う":["って","った","わない"],"つ":["って","った","たない"],"る":["って","った","らない"],"む":["んで","んだ","まない"],"ぶ":["んで","んだ","ばない"],"ぬ":["んで","んだ","なない"],"く":["いて","いた","かない"],"ぐ":["いで","いだ","がない"],"す":["して","した","さない"]};
  function conjOne(d, g){
    if (g === 3) {
      if (/する$/.test(d)) return {te: d.replace(/する$/, "して"), ta: d.replace(/する$/, "した"), nai: d.replace(/する$/, "しない")};
      if (/来る$/.test(d)) return {te: d.replace(/来る$/, "来て"), ta: d.replace(/来る$/, "来た"), nai: d.replace(/来る$/, "来ない")};
      if (/くる$/.test(d)) return {te: d.replace(/くる$/, "きて"), ta: d.replace(/くる$/, "きた"), nai: d.replace(/くる$/, "こない")};
    }
    if (g === 2) { var st = d.slice(0, -1); return {te: st + "て", ta: st + "た", nai: st + "ない"}; }
    var last = d.slice(-1), stem = d.slice(0, -1), r = GODAN[last] || ["て","た","ない"];
    var out = {te: stem + r[0], ta: stem + r[1], nai: stem + r[2]};
    if (/行く$|いく$/.test(d)) { out.te = stem + "って"; out.ta = stem + "った"; }
    if (d === "ある") out.nai = "ない";
    return out;
  }
  function verbForms(v){
    var k = conjOne(v[2], v[4]), r = conjOne(v[3], v[4]);
    return {
      masu: [v[0], v[1]], dict: [v[2], v[3]],
      te: [k.te, r.te], nai: [k.nai, r.nai], ta: [k.ta, r.ta]
    };
  }
  var FORM_META = [["masu","ます形","L4"],["dict","辞書形","L18"],["te","て形","L14"],["nai","ない形","L17"],["ta","た形","L19"]];
  var verbGroup = 0, verbLesson = "", verbSearch = "", verbDrill = null;

  function renderVerbs(){
    if (verbDrill) { renderVerbDrill(); return; }
    var lessons = {};
    VERB_LIST.forEach(function(v){ lessons[v[6]] = true; });
    var lessonTags = Object.keys(lessons).sort(function(a, b){ return parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10); });
    var side = '<aside class="side-filter"><p class="side-title">グループ Group</p><div class="tagbar">' +
      [0,1,2,3].map(function(g){ return '<button class="tag-chip' + (verbGroup === g ? " active" : "") + '" data-vg="' + g + '">' + (g === 0 ? "All" : "第" + ["","I","II","III"][g] + "類") + '</button>'; }).join("") +
      '</div><p class="side-title">課 Lesson</p><div class="tagbar"><button class="tag-chip' + (verbLesson === "" ? " active" : "") + '" data-vl="">All</button>' +
      lessonTags.map(function(l){ return '<button class="tag-chip' + (verbLesson === l ? " active" : "") + '" data-vl="' + l + '">' + l + '</button>'; }).join("") +
      '</div></aside>';
    var main = '<p class="count-note">動詞五大變化總表：ます形（L4）→ 辭書形（L18）／て形（L14）／ない形（L17）／た形（L19）。點任何一格可以聽發音；<span class="irr-mark">紅色標記</span>＝長得像第II類、其實是第I類的陷阱動詞。</p>' +
      '<div class="listen-controls"><button class="btn primary" id="verbDrillBtn">變換練習（10題）</button></div>' +
      '<div class="toolbar"><input type="search" id="verbSearch" autocomplete="off" placeholder="Search a verb (漢字・かな・English)…" value="' + escapeHtml(verbSearch) + '"></div>' +
      '<div id="verbResults"></div>' +
      '<h3 class="detail-h">變化規則速查</h3><div class="verb-rules">' +
      '<p><strong>第I類（五段）</strong>：ます形去ます後的音節在「い段」（き・ぎ・し・ち・に・ひ・み・り…）。て形：う・つ・る→って｜む・ぶ・ぬ→んで｜く→いて（行く→行って例外）｜ぐ→いで｜す→して。ない形：改成「あ段」＋ない（う→わない）。</p>' +
      '<p><strong>第II類（一段）</strong>：ます形去ます後在「え段」（食べ・寝・教え），或少數「い段」（見・起き・借り・着・い）。辭書形：＋る｜て形：＋て｜ない形：＋ない｜た形：＋た。最簡單。</p>' +
      '<p><strong>第III類（不規則）</strong>：します→する・して・しない・した｜来ます→来る（くる）・来て（きて）・来ない（こない）・来た（きた）。</p>' +
      '</div>' +
      '<h3 class="detail-h">丁寧形 → 普通形 <span class="detail-sub">L20</span></h3><div class="verb-wrap"><table class="verb-table plain-table"><thead><tr><th></th><th>現在肯定</th><th>現在否定</th><th>過去肯定</th><th>過去否定</th></tr></thead><tbody>' +
      '<tr><td class="vg">動詞</td><td>書きます<br>→ 書く</td><td>書きません<br>→ 書かない</td><td>書きました<br>→ 書いた</td><td>書きませんでした<br>→ 書かなかった</td></tr>' +
      '<tr><td class="vg">ある</td><td>あります<br>→ ある</td><td>ありません<br>→ <span class="irr-mark">ない</span></td><td>ありました<br>→ あった</td><td>ありませんでした<br>→ <span class="irr-mark">なかった</span></td></tr>' +
      '<tr><td class="vg">い形容詞</td><td>高いです<br>→ 高い</td><td>高くないです<br>→ 高くない</td><td>高かったです<br>→ 高かった</td><td>高くなかったです<br>→ 高くなかった</td></tr>' +
      '<tr><td class="vg">な形容詞</td><td>きれいです<br>→ きれいだ</td><td>きれいじゃ（では）ありません<br>→ きれいじゃ（では）ない</td><td>きれいでした<br>→ きれいだった</td><td>きれいじゃ（では）ありませんでした<br>→ きれいじゃ（では）なかった</td></tr>' +
      '<tr><td class="vg">名詞</td><td>雨です<br>→ 雨だ</td><td>雨じゃ（では）ありません<br>→ 雨じゃ（では）ない</td><td>雨でした<br>→ 雨だった</td><td>雨じゃ（では）ありませんでした<br>→ 雨じゃ（では）なかった</td></tr>' +
      '</tbody></table></div><div class="verb-rules"><p>動詞的普通形就是上表的四個形：辭書形・ない形・た形・なかった形。い形容詞只要拿掉です（不能加だ）。な形容詞和名詞把です換成だ。</p></div>' +
      '<h3 class="detail-h">各形的用法例句</h3><div class="verb-rules">' +
      '<p><strong>て形</strong>：〜てください（請…）・〜ています（正在…）・〜てもいいです（可以…）・〜てから（…之後）→ 待ってください。</p>' +
      '<p><strong>ない形</strong>：〜ないでください（請不要…）・〜なければなりません（必須…）・〜なくてもいいです（不必…）→ 忘れないでください。</p>' +
      '<p><strong>辭書形</strong>：〜ことができます（會…）・趣味は〜ことです・〜まえに（…之前）→ 泳ぐことができます。</p>' +
      '<p><strong>た形</strong>：〜たことがあります（曾經…）・〜たり〜たりします（又…又…）・〜たら（如果…）→ 行ったことがあります。</p>' +
      '</div>';
    content.innerHTML = '<div class="list-layout"><div class="list-main">' + main + '</div>' + side + '</div>';
    renderVerbResults();
    document.getElementById("verbDrillBtn").addEventListener("click", function(){ startVerbDrill(); renderVerbs(); });
    var sb = document.getElementById("verbSearch"), composing = false;
    sb.addEventListener("compositionstart", function(){ composing = true; });
    sb.addEventListener("compositionend", function(){ composing = false; verbSearch = sb.value; renderVerbResults(); });
    sb.addEventListener("input", function(ev){ if (composing || ev.isComposing) return; verbSearch = sb.value; renderVerbResults(); });
    content.querySelectorAll("[data-vg]").forEach(function(c){ c.addEventListener("click", function(){ verbGroup = parseInt(c.getAttribute("data-vg"), 10); renderVerbs(); }); });
    content.querySelectorAll("[data-vl]").forEach(function(c){ c.addEventListener("click", function(){ verbLesson = c.getAttribute("data-vl") || ""; renderVerbs(); }); });
    updateFooterCount();
  }
  function verbHay(v){
    if (!v._hay) {
      var f = verbForms(v);
      v._hay = norm([v[0], v[1], v[2], v[3], f.te[0], f.te[1], f.nai[0], f.nai[1], f.ta[0], f.ta[1], v[5]].join(" "));
    }
    return v._hay;
  }
  function renderVerbResults(){
    var box = document.getElementById("verbResults");
    if (!box) return;
    var q = norm(verbSearch.trim());
    var list = VERB_LIST.filter(function(v){
      if (verbGroup && v[4] !== verbGroup) return false;
      if (verbLesson && v[6] !== verbLesson) return false;
      if (q && verbHay(v).indexOf(q) === -1) return false;
      return true;
    });
    var html = '<p class="count-note">' + list.length + ' verbs</p><div class="verb-wrap"><table class="verb-table"><thead><tr><th>ます形<small>L4</small></th><th>類</th><th>辞書形<small>L18</small></th><th>て形<small>L14</small></th><th>ない形<small>L17</small></th><th>た形<small>L19</small></th><th>意味</th></tr></thead><tbody>';
    list.forEach(function(v){
      var f = verbForms(v);
      function cell(pair){ return '<td class="vf" data-say="' + escapeHtml(pair[1]) + '"><span class="vk">' + escapeHtml(pair[0]) + '</span><span class="vr">' + escapeHtml(pair[1]) + '</span></td>'; }
      html += '<tr' + (v[7] ? ' class="trap"' : '') + '>' + cell(f.masu) + '<td class="vg">' + ["","I","II","III"][v[4]] + (v[7] ? '<span class="irr-mark">!</span>' : '') + '</td>' + cell(f.dict) + cell(f.te) + cell(f.nai) + cell(f.ta) + '<td class="vm">' + escapeHtml(v[5]) + '<small>' + escapeHtml(v[6]) + '</small></td></tr>';
    });
    html += '</tbody></table></div>';
    box.innerHTML = html;
    box.querySelectorAll(".vf").forEach(function(td){ td.addEventListener("click", function(){ speak(td.getAttribute("data-say")); }); });
  }

  // --- verb conversion drill ---
  function wrongForms(v, key){
    var d = v[2], out = [];
    [1, 2, 3].forEach(function(g){ if (g !== v[4]) { try { var c = conjOne(d, g); if (c[key]) out.push(c[key]); } catch (e) {} } });
    if (v[4] === 1) {
      var stem = d.slice(0, -1);
      ["って","んで","いて","して"].forEach(function(e){ out.push(stem + (key === "ta" ? e.replace(/て$/, "た").replace(/で$/, "だ") : e)); });
      if (key === "nai") { out.push(stem + "ない"); out.push(d + "ない"); }
    }
    if (key === "dict") { out.push(v[0].replace(/ます$/, "る")); out.push(v[0].replace(/ます$/, "")); }
    return out;
  }
  function startVerbDrill(){
    var pool = VERB_LIST.filter(function(v){ return (!verbGroup || v[4] === verbGroup) && (!verbLesson || v[6] === verbLesson); });
    if (pool.length < 4) pool = VERB_LIST;
    var keys = ["dict","te","nai","ta"];
    var qs = shuffleArr(pool).slice(0, 10).map(function(v){
      var key = keys[Math.floor(Math.random() * keys.length)];
      var f = verbForms(v);
      var correct = f[key][0];
      var ds = wrongForms(v, key).filter(function(x){ return x && x !== correct; });
      ds = shuffleArr(ds.filter(function(x, i, a){ return a.indexOf(x) === i; })).slice(0, 3);
      while (ds.length < 3) { var o = verbForms(pool[Math.floor(Math.random() * pool.length)])[key][0]; if (o !== correct && ds.indexOf(o) === -1) ds.push(o); }
      return {v: v, key: key, correct: correct, correctKana: f[key][1], options: shuffleArr([correct].concat(ds))};
    });
    verbDrill = {questions: qs, idx: 0, score: 0, answered: false, missed: []};
  }
  function renderVerbDrill(){
    var d = verbDrill;
    if (d.idx >= d.questions.length) {
      var html = '<div class="quiz-summary"><div class="big-score">' + d.score + ' / ' + d.questions.length + '</div>';
      if (d.missed.length) {
        html += '<p class="count-note">要再看一次：</p><ul>';
        d.missed.forEach(function(m){ var fm = FORM_META.filter(function(x){ return x[0] === m.key; })[0]; html += '<li><strong>' + escapeHtml(m.v[0]) + '</strong>（第' + ["","I","II","III"][m.v[4]] + '類）→ ' + escapeHtml(fm[1]) + '：<span class="irr-mark">' + escapeHtml(m.correct) + '</span> ' + speakerBtn(m.correctKana) + '</li>'; });
        html += '</ul>';
      } else { html += '<p class="count-note">全對——完璧です！</p>'; }
      html += '<div class="start-row"><button class="btn primary" id="vAgain">再來一次</button> <button class="btn" id="vBack">回到總表</button></div></div>';
      content.innerHTML = html;
      document.getElementById("vAgain").addEventListener("click", function(){ startVerbDrill(); renderVerbs(); });
      document.getElementById("vBack").addEventListener("click", function(){ verbDrill = null; renderVerbs(); });
      wireSpeakers();
      return;
    }
    var q = d.questions[d.idx];
    var fm = FORM_META.filter(function(x){ return x[0] === q.key; })[0];
    var html2 = '<div class="quiz-feedback-row"><span class="quiz-q">変換練習 · 第 ' + (d.idx + 1) + ' 題／共 ' + d.questions.length + ' 題</span><span class="quiz-score-line">Score: ' + d.score + '</span></div>';
    html2 += '<div class="quiz-jp">' + escapeHtml(q.v[0]) + '</div><div class="quiz-reading">' + escapeHtml(q.v[1]) + ' · ' + escapeHtml(q.v[5]) + '</div>';
    html2 += '<p class="count-note">→ <strong>' + escapeHtml(fm[1]) + '</strong>（' + fm[2] + '）是什麼？</p><div class="quiz-options">';
    q.options.forEach(function(opt){ html2 += '<button class="quiz-opt" data-r="' + escapeHtml(opt) + '">' + escapeHtml(opt) + '<span class="quiz-mark"></span></button>'; });
    html2 += '</div><div id="vExplain"></div><div class="start-row" id="vNextWrap" style="display:none;"><button class="btn primary" id="vNext">下一題</button></div>';
    content.innerHTML = html2;
    var btns = content.querySelectorAll(".quiz-opt");
    btns.forEach(function(b){
      b.addEventListener("click", function(){
        if (d.answered) return;
        d.answered = true;
        var chosen = b.getAttribute("data-r");
        if (chosen === q.correct) d.score++; else d.missed.push(q);
        btns.forEach(function(b2){
          b2.disabled = true;
          var mk = b2.querySelector(".quiz-mark");
          if (b2.getAttribute("data-r") === q.correct) { b2.classList.add("correct"); mk.textContent = "◯"; }
          else if (b2.getAttribute("data-r") === chosen) { b2.classList.add("wrong"); mk.textContent = "✗"; }
        });
        speak(q.correctKana);
        var f = verbForms(q.v);
        document.getElementById("vExplain").innerHTML = '<p class="num-note">第' + ["","I","II","III"][q.v[4]] + '類' + (q.v[7] ? '（陷阱：看起來像第II類！）' : '') + '：' + escapeHtml(f.dict[0]) + ' → て形 ' + escapeHtml(f.te[0]) + '・ない形 ' + escapeHtml(f.nai[0]) + '・た形 ' + escapeHtml(f.ta[0]) + '</p>';
        document.getElementById("vNextWrap").style.display = "block";
      });
    });
    document.getElementById("vNext").addEventListener("click", function(){ d.idx++; d.answered = false; renderVerbDrill(); });
  }

  // ---------- Particles (助詞) ----------
  var partFilter = "", partDrill = null;
  function renderParticles(){
    if (partDrill) { renderPartDrill(); return; }
    var side = '<aside class="side-filter"><p class="side-title">助詞 Particle</p><div class="tagbar"><button class="tag-chip' + (partFilter === "" ? " active" : "") + '" data-pp="">All</button>' +
      PARTICLES.map(function(x){ return '<button class="tag-chip' + (partFilter === x.p ? " active" : "") + '" data-pp="' + escapeHtml(x.p) + '">' + escapeHtml(x.p) + '</button>'; }).join("") + '</div></aside>';
    var main = '<p class="count-note">每個助詞的全部用法，附課別、說明、例句（點 🔊 聽）。下方「助詞練習」是 JLPT 最常見的填空題型。</p>' +
      '<div class="listen-controls"><button class="btn primary" id="partDrillBtn">助詞練習（10題）</button></div>';
    PARTICLES.forEach(function(x){
      if (partFilter && x.p !== partFilter) return;
      main += '<div class="p-card"><div class="p-head"><span class="p-big">' + escapeHtml(x.p) + '</span><span class="p-name">' + escapeHtml(x.name) + '</span></div>';
      x.uses.forEach(function(u){
        main += '<div class="p-use"><span class="seal-chip static">' + escapeHtml(u[0]) + '</span><div class="p-body"><div class="p-how">' + escapeHtml(u[1]) + '</div>' +
          '<div class="p-ex">' + escapeHtml(u[2]) + ' ' + speakerBtn(u[2]) + '</div><div class="t-zh">' + escapeHtml(u[3]) + '</div></div></div>';
      });
      main += '</div>';
    });
    content.innerHTML = '<div class="list-layout"><div class="list-main">' + main + '</div>' + side + '</div>';
    document.getElementById("partDrillBtn").addEventListener("click", function(){ startPartDrill(); renderParticles(); });
    content.querySelectorAll("[data-pp]").forEach(function(c){ c.addEventListener("click", function(){ partFilter = c.getAttribute("data-pp") || ""; renderParticles(); }); });
    wireSpeakers();
    updateFooterCount();
  }
  function startPartDrill(){
    var qs = shuffleArr(PARTICLE_DRILL).slice(0, 10).map(function(d){ return {q: d[0], a: d[1], options: shuffleArr(d[2]), zh: d[3]}; });
    partDrill = {questions: qs, idx: 0, score: 0, answered: false, missed: []};
  }
  function renderPartDrill(){
    var d = partDrill;
    if (d.idx >= d.questions.length) {
      var html = '<div class="quiz-summary"><div class="big-score">' + d.score + ' / ' + d.questions.length + '</div>';
      if (d.missed.length) {
        html += '<p class="count-note">要再看一次：</p><ul>';
        d.missed.forEach(function(m){ html += '<li>' + escapeHtml(m.q.replace("＿", "［" + m.a + "］")) + ' <span class="detail-sub">' + escapeHtml(m.zh) + '</span></li>'; });
        html += '</ul>';
      } else { html += '<p class="count-note">全對——完璧です！</p>'; }
      html += '<div class="start-row"><button class="btn primary" id="pAgain">再來一次</button> <button class="btn" id="pBack">回到助詞表</button></div></div>';
      content.innerHTML = html;
      document.getElementById("pAgain").addEventListener("click", function(){ startPartDrill(); renderParticles(); });
      document.getElementById("pBack").addEventListener("click", function(){ partDrill = null; renderParticles(); });
      return;
    }
    var q = d.questions[d.idx];
    var html2 = '<div class="quiz-feedback-row"><span class="quiz-q">助詞練習 · 第 ' + (d.idx + 1) + ' 題／共 ' + d.questions.length + ' 題</span><span class="quiz-score-line">Score: ' + d.score + '</span></div>';
    html2 += '<div class="quiz-jp p-q">' + escapeHtml(q.q).replace("＿", '<span class="p-blank">＿</span>') + '</div><div class="quiz-reading">' + escapeHtml(q.zh) + '</div>';
    html2 += '<div class="quiz-options p-opts">';
    q.options.forEach(function(opt){ html2 += '<button class="quiz-opt" data-r="' + escapeHtml(opt) + '">' + escapeHtml(opt) + '<span class="quiz-mark"></span></button>'; });
    html2 += '</div><div class="start-row" id="pNextWrap" style="display:none;"><button class="btn primary" id="pNext">下一題</button></div>';
    content.innerHTML = html2;
    var btns = content.querySelectorAll(".quiz-opt");
    btns.forEach(function(b){
      b.addEventListener("click", function(){
        if (d.answered) return;
        d.answered = true;
        var chosen = b.getAttribute("data-r");
        if (chosen === q.a) d.score++; else d.missed.push(q);
        btns.forEach(function(b2){
          b2.disabled = true;
          var mk = b2.querySelector(".quiz-mark");
          if (b2.getAttribute("data-r") === q.a) { b2.classList.add("correct"); mk.textContent = "◯"; }
          else if (b2.getAttribute("data-r") === chosen) { b2.classList.add("wrong"); mk.textContent = "✗"; }
        });
        var full = q.q.replace("＿", q.a).replace(/（[^）]*）$/, "");
        content.querySelector(".p-q").innerHTML = escapeHtml(full) + ' ' + speakerBtn(full);
        wireSpeakers();
        speak(full);
        document.getElementById("pNextWrap").style.display = "block";
      });
    });
    document.getElementById("pNext").addEventListener("click", function(){ d.idx++; d.answered = false; renderPartDrill(); });
  }

  // ---------- Flashcards ----------
  var fcState = { filter: "all", deck: [], pos: 0, flipped: false };

  function buildDeck(filter){
    var pool = entries.filter(function(e){ return (filter === "all" || e.category === filter) && e.jp.length <= 60; });
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool;
  }

  function renderFlashcards(){
    if (fcState.deck.length === 0) {
      fcState.deck = buildDeck(fcState.filter);
      fcState.pos = 0;
      fcState.flipped = false;
    }
    var deck = fcState.deck;
    var html = '<div class="fc-controls">' +
      '<select id="fcFilter">' +
        '<option value="all"' + (fcState.filter === "all" ? " selected" : "") + '>All</option>' +
        '<option value="vocab"' + (fcState.filter === "vocab" ? " selected" : "") + '>Vocabulary</option>' +
        '<option value="phrase"' + (fcState.filter === "phrase" ? " selected" : "") + '>Phrases</option>' +
        '<option value="grammar"' + (fcState.filter === "grammar" ? " selected" : "") + '>Grammar</option>' +
      '</select>' +
      '<button class="btn" id="fcShuffle">Shuffle</button>' +
      '<span class="fc-progress">' + (deck.length ? (fcState.pos + 1) + ' / ' + deck.length : "0 / 0") + '</span>' +
    '</div>';

    if (!deck.length) {
      html += '<div class="empty-state">No entries in this set yet. Add some, or pick "All".</div>';
      content.innerHTML = html;
      wireFcControls();
      return;
    }

    var e = deck[fcState.pos];
    var canSpeak = e.category !== "grammar";
    html += '<div class="fc-stage"><div class="fc-card' + (fcState.flipped ? ' flipped' : '') + '" id="fcCard">' +
      '<div class="fc-card-inner">' +
        '<div class="fc-face front">' +
          '<div class="big-jp">' + escapeHtml(e.jp) + '</div>' +
          (e.reading ? '<div class="fc-reading">' + escapeHtml(e.reading) + '</div>' : '') +
          (canSpeak ? '<div class="fc-audio">' + speakerBtn(speakTextFor(e), "big") + '</div>' : '') +
          '<span class="hint">tap to flip</span>' +
        '</div>' +
        '<div class="fc-face back">' +
          '<div class="fc-meaning">' + escapeHtml(e.meaning) + '</div>' +
          (e.notes ? '<div class="fc-notes">' + escapeHtml(e.notes) + '</div>' : '') +
        '</div>' +
      '</div>' +
    '</div></div>';

    html += '<div class="fc-nav"><button class="btn" id="fcPrev">◀ Prev</button><button class="btn primary" id="fcNext">Next ▶</button></div>';

    content.innerHTML = html;
    wireFcControls();
    wireSpeakers();

    var card = document.getElementById("fcCard");
    card.addEventListener("click", function(){
      fcState.flipped = !fcState.flipped;
      card.classList.toggle("flipped", fcState.flipped);
    });
    document.getElementById("fcPrev").addEventListener("click", function(){
      fcState.pos = (fcState.pos - 1 + deck.length) % deck.length;
      fcState.flipped = false;
      renderFlashcards();
    });
    document.getElementById("fcNext").addEventListener("click", function(){
      fcState.pos = (fcState.pos + 1) % deck.length;
      fcState.flipped = false;
      renderFlashcards();
    });
  }
  function wireFcControls(){
    var sel = document.getElementById("fcFilter");
    if (sel) sel.addEventListener("change", function(){
      fcState.filter = sel.value;
      fcState.deck = [];
      renderFlashcards();
    });
    var sh = document.getElementById("fcShuffle");
    if (sh) sh.addEventListener("click", function(){
      fcState.deck = [];
      renderFlashcards();
    });
  }

  // ---------- Quiz (JLPT-format trainer; all questions original) ----------
  var quizState = null;
  var QUIZ_FORMATS = [
    ["kanji","漢字読み","もじ・ごい 1"],["ortho","表記","もじ・ごい 2"],["fill","文脈規定","もじ・ごい 3"],["para","言い換え","もじ・ごい 4"],
    ["particle","助詞","ぶんぽう 1"],["gram","文法形式","ぶんぽう 1"],["star","★並べ替え","ぶんぽう 2"],["textg","文章の文法","ぶんぽう 3"],
    ["read","読解","どっかい"],["say","発話表現","ちょうかい 3"],["lconv","会話聴解","ちょうかい 1・2 (audio)"],["qr","即時応答","ちょうかい 4 (audio)"],
    ["vocab","語彙","word meaning"],["verb","活用","verb forms"],["plain","普通形","polite → plain"],["order","文作り","build the sentence"],["conv","会話完成","dialogue"],["ant","反義語","opposite word"]
  ];
  var quizSel = {};
  QUIZ_FORMATS.forEach(function(f){ quizSel[f[0]] = true; });
  var MOCK_PLAN = [["kanji",4],["ortho",3],["fill",4],["para",2],["gram",3],["particle",3],["star",2],["textg",2],["read",4],["say",2],["lconv",2],["qr",3]];

  function shuffleArr(arr){
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }
  function fmtTime(ms){ var sec = Math.floor(ms / 1000), m = Math.floor(sec / 60); sec = sec % 60; return m + ":" + (sec < 10 ? "0" : "") + sec; }
  function qHead(t){ return '<p class="count-note">' + t + '</p>'; }
  function blankHtml(t){ return escapeHtml(t).replace(/＿/g, '<span class="p-blank">＿</span>'); }
  function afterLine(full, zh){ return '<p class="num-note"><span class="t-jp">' + escapeHtml(full) + '</span> ' + speakerBtn(full) + (zh ? '<br>' + escapeHtml(zh) : '') + '</p>'; }
  function mcQ(type, key, html, correct, ds, extra){
    var q = {type: type, key: type + ":" + key, html: html, correct: correct, options: shuffleArr([correct].concat(ds))};
    if (extra) { for (var k in extra) q[k] = extra[k]; }
    return q;
  }

  var DAKU = {"か":"が","き":"ぎ","く":"ぐ","け":"げ","こ":"ご","さ":"ざ","し":"じ","す":"ず","せ":"ぜ","そ":"ぞ","た":"だ","て":"で","と":"ど","は":"ば","ひ":"び","ふ":"ぶ","へ":"べ","ほ":"ぼ"};
  var UNDAKU = {};
  Object.keys(DAKU).forEach(function(k){ UNDAKU[DAKU[k]] = k; });
  function kanaVariants(r){
    var out = [], i, c;
    function toggleAt(idx){ var ch = r.charAt(idx), t = DAKU[ch] || UNDAKU[ch]; return t ? r.slice(0, idx) + t + r.slice(idx + 1) : null; }
    for (i = 0; i < r.length; i++) { c = toggleAt(i); if (c) { out.push(c); break; } }
    for (i = r.length - 1; i >= 0; i--) { c = toggleAt(i); if (c) { out.push(c); break; } }
    if (/[ょゅ]う/.test(r)) out.push(r.replace(/([ょゅ])う/, "$1")); else if (/[ょゅ]/.test(r)) out.push(r.replace(/([ょゅ])/, "$1う"));
    if (/っ/.test(r)) out.push(r.replace("っ", "")); else if (r.length >= 3) out.push(r.slice(0, 1) + "っ" + r.slice(1));
    if (/[おこそとのほもよろ]う/.test(r)) out.push(r.replace(/([おこそとのほもよろ])う/, "$1"));
    return out.filter(function(x, k, a){ return x !== r && a.indexOf(x) === k; });
  }

  function makeVocabQ(){
    var pool = entries.filter(function(e){ return (e.category === "vocab" || e.category === "phrase") && e.jp.length <= 22 && tagsOf(e).indexOf("会話") === -1; });
    if (pool.length < 4) return null;
    var c = pick(pool), ds = [], g = 0;
    while (ds.length < 3 && g++ < 80) { var o = pick(pool).meaning; if (o !== c.meaning && ds.indexOf(o) === -1) ds.push(o); }
    return mcQ("vocab", c.id, '<div class="quiz-jp">' + escapeHtml(c.jp) + ' ' + speakerBtn(speakTextFor(c)) + '</div>' + (c.reading ? '<div class="quiz-reading">' + escapeHtml(c.reading) + '</div>' : '') + qHead("意思是？"), c.meaning, ds, {missTxt: c.jp + " = " + c.meaning});
  }
  function makeKanjiQ(){
    var pool = entries.filter(function(e){ return e.category === "vocab" && /[\u4E00-\u9FFF]/.test(e.jp) && /^[\u3040-\u309F]+$/.test(e.reading || "") && !/[〜～（／]/.test(e.jp) && e.jp.length <= 6; });
    if (pool.length < 4) return null;
    var c = pick(pool), ds = shuffleArr(kanaVariants(c.reading)).slice(0, 3), g = 0;
    while (ds.length < 3 && g++ < 80) { var o = pick(pool).reading; if (o !== c.reading && ds.indexOf(o) === -1) ds.push(o); }
    return mcQ("kanji", c.id, '<div class="quiz-jp"><span class="uline">' + escapeHtml(c.jp) + '</span></div>' + qHead("ひらがなで どう かきますか。（" + escapeHtml(c.meaning) + "）"), c.reading, ds, {speak: c.reading, missTxt: c.jp + " = " + c.reading});
  }
  function makeOrthoQ(){
    var d = pick(ORTHO_BANK);
    return mcQ("ortho", d[0], '<div class="quiz-jp"><span class="uline">' + escapeHtml(d[0]) + '</span></div>' + qHead("どう かきますか。（" + escapeHtml(d[5]) + "）"), d[1], [d[2], d[3], d[4]], {optClass: "p-opts", missTxt: d[0] + " = " + d[1]});
  }
  function makeFillQ(){
    var d = pick(FILL_DRILL), full = d[0].replace("（＿）", d[1][0]);
    return mcQ("fill", d[0], '<div class="quiz-jp p-q">' + blankHtml(d[0]) + '</div>' + qHead("（　）に なにが はいりますか。"), d[1][0], d[1].slice(1), {after: afterLine(full, d[2]), speak: full, missTxt: full});
  }
  function makeParaQ(){
    var d = pick(PARA_BANK);
    return mcQ("para", d[0], '<div class="quiz-jp p-q"><span class="uline">' + escapeHtml(d[0]) + '</span></div>' + qHead("だいたい おなじ いみの ぶんは どれですか。"), d[1], [d[2], d[3], d[4]], {optClass: "long-opts", after: '<p class="num-note">' + escapeHtml(d[5]) + '</p>', missTxt: d[0] + " ＝ " + d[1]});
  }
  function makeParticleQ(){
    var d = pick(PARTICLE_DRILL), full = d[0].split("＿").join(d[1]).replace(/（[^）]*）$/, "");
    return mcQ("particle", d[0], '<div class="quiz-jp p-q">' + blankHtml(d[0]) + '</div><div class="quiz-reading">' + escapeHtml(d[3]) + '</div>' + qHead("（　）に 何を 入れますか。"), d[1], d[2].filter(function(x){ return x !== d[1]; }), {optClass: "p-opts", after: afterLine(full, ""), speak: full, missTxt: full});
  }
  function makeGramQ(){
    var d = pick(GRAM_BANK), full = d[0].replace("（＿）", d[1]);
    return mcQ("gram", d[0], '<div class="quiz-jp p-q">' + blankHtml(d[0]) + '</div>' + qHead("（　）に 何を 入れますか。"), d[1], [d[2], d[3], d[4]], {after: afterLine(full, d[5]), speak: full, missTxt: full});
  }
  function makeVerbQ(){
    var v = pick(VERB_LIST), key = pick(["dict","te","nai","ta"]), f = verbForms(v), correct = f[key][0];
    var ds = wrongForms(v, key).filter(function(x){ return x && x !== correct; });
    ds = shuffleArr(ds.filter(function(x, i, a){ return a.indexOf(x) === i; })).slice(0, 3);
    var g = 0;
    while (ds.length < 3 && g++ < 80) { var o = verbForms(pick(VERB_LIST))[key][0]; if (o !== correct && ds.indexOf(o) === -1) ds.push(o); }
    var fm = FORM_META.filter(function(x){ return x[0] === key; })[0];
    return mcQ("verb", v[0] + key, '<div class="quiz-jp">' + escapeHtml(v[0]) + '</div><div class="quiz-reading">' + escapeHtml(v[1]) + ' · ' + escapeHtml(v[5]) + '</div>' + qHead('→ <strong>' + escapeHtml(fm[1]) + '</strong>（' + fm[2] + '）'), correct, ds, {optClass: "p-opts", speak: f[key][1],
      after: '<p class="num-note">第' + ["","I","II","III"][v[4]] + '類' + (v[7] ? '（陷阱：看起來像第II類！）' : '') + '：' + escapeHtml(f.dict[0]) + ' → て形 ' + escapeHtml(f.te[0]) + '・ない形 ' + escapeHtml(f.nai[0]) + '・た形 ' + escapeHtml(f.ta[0]) + '</p>', missTxt: v[0] + " → " + fm[1] + "：" + correct});
  }
  function makePlainQ(){
    var d = pick(PLAIN_BANK);
    return mcQ("plain", d[0], '<div class="quiz-jp">' + escapeHtml(d[0]) + '</div>' + qHead("→ 普通形（常體）は？"), d[1], [d[2], d[3], d[4]], {optClass: "p-opts", speak: d[1], missTxt: d[0] + " → " + d[1]});
  }
  function makeStarQ(){
    var d = pick(STAR_BANK), si = d[3], full = d[0] + d[1].join("") + d[2];
    var blanks = d[1].map(function(w, i){ return '<span class="p-blank">' + (i === si ? "★" : "＿") + '</span>'; }).join(" ");
    return mcQ("star", d[0] + d[2], '<div class="quiz-jp p-q">' + escapeHtml(d[0]) + ' ' + blanks + ' ' + escapeHtml(d[2]) + '</div>' + qHead("★ に 入る ものは どれですか。"), d[1][si], d[1].filter(function(w, i){ return i !== si; }), {optClass: "p-opts", after: afterLine(full, d[4]), speak: full, missTxt: full + "（★＝" + d[1][si] + "）"});
  }
  function makeTextgQ(){
    var d = pick(TEXTG_BANK), full = d[0].replace("（＿）", d[1]);
    return mcQ("textg", d[0], '<div class="read-box">' + blankHtml(d[0]) + '</div>' + qHead("（　）に 何を 入れますか。ぶんしょうの いみを かんがえて えらんで ください。"), d[1], [d[2], d[3], d[4]], {after: afterLine(full, d[5]), missTxt: full});
  }
  function makeReadQ(){
    var d = pick(READ_BANK), html = '<div class="read-box">' + escapeHtml(d.p) + '</div>';
    if (d.t) {
      html += '<div class="verb-wrap"><table class="verb-table read-table">';
      d.t.forEach(function(row, i){ html += '<tr>' + row.map(function(c){ return (i === 0 ? '<th>' : '<td>') + escapeHtml(c) + (i === 0 ? '</th>' : '</td>'); }).join("") + '</tr>'; });
      html += '</table></div>';
    }
    html += '<div class="listen-q">' + escapeHtml(d.q) + '</div>';
    return mcQ("read", d.q, html, d.o[0], d.o.slice(1), {optClass: "long-opts", after: '<p class="num-note">' + escapeHtml(d.z) + '</p>', missTxt: d.q + " → " + d.o[0]});
  }
  function makeConvQ(){
    var d = pick(CONV_DRILL), full = d[0].replace("＿", d[2][0]) + " " + d[1].replace("＿", d[2][0]);
    var html = '<div class="conv-box"><div class="conv-line"><span class="t-spk">A</span><span class="t-jp">' + blankHtml(d[0]) + '</span></div><div class="conv-line"><span class="t-spk">B</span><span class="t-jp">' + blankHtml(d[1]) + '</span></div></div>' + qHead("＿ 裡應該說什麼？");
    return mcQ("conv", d[0], html, d[2][0], d[2].slice(1), {after: afterLine(full.replace(/[（）]/g, ""), d[3]), speak: full.replace(/[（）]/g, ""), missTxt: full.replace(/[（）]/g, "")});
  }
  function makeSayQ(){
    var d = pick(SAY_BANK);
    return mcQ("say", d[0], '<div class="listen-q">' + escapeHtml(d[0]) + '</div>', d[1], [d[2], d[3]], {sec: "L", after: '<p class="num-note">' + escapeHtml(d[4]) + '</p>', speak: d[1], missTxt: d[0] + " → " + d[1]});
  }
  function makeQRQ(){
    var it = pick(LISTEN_QR), q = mcQ("qr", it.q, qHead("聽完後選出正確的回應（選項用聽的，先不看字）"), it.opts[0], it.opts.slice(1), {sec: "L", hideOpts: true, optClass: "qr-opts", missTxt: it.q + " → " + it.opts[0]});
    q.audio = [{t: it.q, p: 1}].concat(q.options.map(function(o, i){ return {t: (i + 1) + "番。" + o, p: 0.85}; }));
    q.after = '<p class="num-note"><span class="t-jp">' + escapeHtml(it.q) + '</span><br>' + escapeHtml(it.zh) + '</p>';
    return q;
  }
  function makeLConvQ(){
    var it = pick(LISTEN_CONV);
    var tr = it.lines.map(function(l){ return '<span class="t-spk">' + escapeHtml(l[0]) + '</span> ' + escapeHtml(l[1]) + '<br><span class="t-zh">' + escapeHtml(l[2]) + '</span>'; }).join("<br>");
    return mcQ("lconv", it.q, qHead("聽對話，回答問題（先不看逐字稿）") + '<div class="listen-q">' + escapeHtml(it.q) + '</div>', it.opts[0], it.opts.slice(1), {sec: "L", audio: convPlayParts(it), after: '<p class="num-note">' + tr + '<br>' + escapeHtml(it.qzh) + '</p>', missTxt: it.q + " → " + it.opts[0]});
  }
  function makeOrderQ(){
    var d = pick(ORDER_DRILL);
    return {type: "order", key: "order:" + d[0].join(""), words: d[0], tiles: shuffleArr(d[0].map(function(w, i){ return {w: w, i: i}; })), picked: [], zh: d[1], missTxt: d[0].join("")};
  }
  function makeAntQ(){
    var pool = [];
    ANT_PAIRS.forEach(function(p){ var a = findVocabBase(p[0]), b = findVocabBase(p[1]); if (a && b) { pool.push([a, b]); pool.push([b, a]); } });
    if (pool.length < 4) return null;
    var pr = pick(pool), a = pr[0], b = pr[1];
    var bad = antList(a).concat([antBase(a.jp), antBase(b.jp)]), ds = [], g = 0;
    while (ds.length < 3 && g++ < 120) { var o = pick(pool)[0]; if (bad.indexOf(antBase(o.jp)) === -1 && ds.indexOf(o.jp) === -1) ds.push(o.jp); }
    return mcQ("ant", a.id, '<div class="quiz-jp">' + escapeHtml(a.jp) + ' ' + speakerBtn(speakTextFor(a)) + '</div><div class="quiz-reading">' + escapeHtml(a.reading || "") + ' · ' + escapeHtml(a.meaning) + '</div>' + qHead("反対の いみの ことばは どれですか。"), b.jp, ds, {optClass: "p-opts", speak: speakTextFor(b), missTxt: a.jp + " ⇄ " + b.jp});
  }
  var MAKERS = {vocab: makeVocabQ, kanji: makeKanjiQ, ortho: makeOrthoQ, fill: makeFillQ, para: makeParaQ, particle: makeParticleQ, gram: makeGramQ, verb: makeVerbQ, plain: makePlainQ, star: makeStarQ, textg: makeTextgQ, read: makeReadQ, conv: makeConvQ, say: makeSayQ, qr: makeQRQ, lconv: makeLConvQ, order: makeOrderQ, ant: makeAntQ};

  function newState(qs, mock){
    var st = {questions: qs, idx: 0, score: 0, answered: false, missed: [], mock: !!mock, t0: Date.now(), secScore: {G: 0, L: 0}, secTotal: {G: 0, L: 0}};
    qs.forEach(function(q){ st.secTotal[q.sec || "G"]++; });
    return st;
  }
  function buildMixedQuiz(n){
    var types = Object.keys(quizSel).filter(function(k){ return quizSel[k]; });
    if (!types.length) types = ["vocab"];
    var qs = [], used = {}, guard = 0, i = 0, order = shuffleArr(types);
    while (qs.length < n && guard++ < 400) {
      var q = MAKERS[order[i % order.length]](); i++;
      if (!q || used[q.key]) continue;
      used[q.key] = true; qs.push(q);
    }
    return newState(qs, false);
  }
  function buildMock(){
    var qs = [], used = {};
    MOCK_PLAN.forEach(function(p){
      var n = 0, g = 0;
      while (n < p[1] && g++ < 120) { var q = MAKERS[p[0]](); if (!q || used[q.key]) continue; used[q.key] = true; qs.push(q); n++; }
    });
    return newState(qs, true);
  }
  var mockTick = null;
  function startTick(){
    if (mockTick) clearInterval(mockTick);
    mockTick = setInterval(function(){
      var el = document.getElementById("mockTimer");
      if (!el || !quizState || !quizState.mock) { clearInterval(mockTick); mockTick = null; return; }
      el.textContent = fmtTime(Date.now() - quizState.t0);
    }, 1000);
  }

  function renderQuiz(){
    if (!quizState) {
      stopSpeech();
      var total = 0; MOCK_PLAN.forEach(function(p){ total += p[1]; });
      var html = '<div class="mock-card"><div class="pack-jp">模擬試験</div><div class="pack-en">JLPT N5 format · ' + total + ' 題 · 文字語彙 → 文法 → 読解 → 聴解</div>' +
        '<p class="pack-desc">題型與順序比照正式考試（文字・語彙 もんだい1〜4、文法 1〜3、読解、聴解）。題目全部是原創練習題，不是官方試題。結束後顯示各科得分與合格線估算。</p>' +
        '<button class="btn primary" id="startMock">開始模擬試験</button></div>';
      html += '<h3 class="detail-h">自由練習 <span class="detail-sub">勾選題型，每次 10 題</span></h3><div class="fmt-grid">';
      QUIZ_FORMATS.forEach(function(f){
        html += '<label class="fmt-opt"><input type="checkbox" data-fmt="' + f[0] + '"' + (quizSel[f[0]] ? ' checked' : '') + '><span><span class="fmt-jp">' + f[1] + '</span><br><span class="fmt-en">' + f[2] + '</span></span></label>';
      });
      html += '</div><div class="start-row"><button class="btn primary" id="startQuiz">Start practice (10)</button> <button class="btn" id="selAll">全選</button> <button class="btn" id="selNone">全不選</button></div>' +
        '<p class="num-note">官方樣題（免費）：<a class="jisho-link" href="https://www.jlpt.jp/e/samples/sample09.html" target="_blank" rel="noopener">jlpt.jp N5 sample ↗</a></p>';
      content.innerHTML = html;
      content.querySelectorAll("[data-fmt]").forEach(function(cb){ cb.addEventListener("change", function(){ quizSel[cb.getAttribute("data-fmt")] = cb.checked; }); });
      document.getElementById("selAll").addEventListener("click", function(){ QUIZ_FORMATS.forEach(function(f){ quizSel[f[0]] = true; }); renderQuiz(); });
      document.getElementById("selNone").addEventListener("click", function(){ QUIZ_FORMATS.forEach(function(f){ quizSel[f[0]] = false; }); renderQuiz(); });
      document.getElementById("startQuiz").addEventListener("click", function(){ quizState = buildMixedQuiz(10); renderQuiz(); });
      document.getElementById("startMock").addEventListener("click", function(){ quizState = buildMock(); startTick(); renderQuiz(); });
      return;
    }
    var st = quizState;
    function fmtOf(t){ return QUIZ_FORMATS.filter(function(f){ return f[0] === t; })[0]; }
    if (st.idx >= st.questions.length) {
      stopSpeech();
      var h2 = '<div class="quiz-summary"><div class="big-score">' + st.score + ' / ' + st.questions.length + '</div>';
      if (st.mock) {
        var pg = st.secTotal.G ? Math.round(100 * st.secScore.G / st.secTotal.G) : 0, pl = st.secTotal.L ? Math.round(100 * st.secScore.L / st.secTotal.L) : 0, pt = Math.round(100 * st.score / st.questions.length);
        var pass = pt >= 45 && pg >= 32 && pl >= 32;
        h2 += '<table class="verb-table"><tr><th>科目</th><th>得分</th><th>%</th></tr>' +
          '<tr><td>言語知識（文字・語彙・文法）・読解</td><td>' + st.secScore.G + ' / ' + st.secTotal.G + '</td><td>' + pg + '%</td></tr>' +
          '<tr><td>聴解</td><td>' + st.secScore.L + ' / ' + st.secTotal.L + '</td><td>' + pl + '%</td></tr></table>' +
          '<p class="order-verdict ' + (pass ? 'ok' : 'ng') + '">' + (pass ? '◯ 達到合格線（估算）' : '✗ 未達合格線（估算）') + '</p>' +
          '<p class="num-note">用時 ' + fmtTime(Date.now() - st.t0) + '。正式考試合格標準：總分 80/180（約45%），且兩科各達約32%。這裡只是用答對率估算，正式考試採用換算分數。</p>';
      }
      if (st.missed.length) {
        h2 += '<p class="count-note">要再看一次：</p><ul>';
        st.missed.forEach(function(m){ h2 += '<li><span class="seal-chip static">' + fmtOf(m.type)[1] + '</span> ' + escapeHtml(m.missTxt || "") + '</li>'; });
        h2 += '</ul>';
      } else { h2 += '<p class="count-note">全對——完璧です！</p>'; }
      h2 += '<div class="start-row"><button class="btn primary" id="retryQuiz">再來一次</button> <button class="btn" id="quizHome">回到選單</button></div></div>';
      content.innerHTML = h2;
      var wasMock = st.mock;
      document.getElementById("retryQuiz").addEventListener("click", function(){ quizState = wasMock ? buildMock() : buildMixedQuiz(10); if (wasMock) startTick(); renderQuiz(); });
      document.getElementById("quizHome").addEventListener("click", function(){ quizState = null; renderQuiz(); });
      return;
    }

    var q = st.questions[st.idx], fm = fmtOf(q.type);
    var h = '<div class="quiz-feedback-row"><span class="quiz-q"><span class="seal-chip static">' + fm[1] + '</span> ' + (st.mock ? escapeHtml(fm[2]) + ' · ' : '') + '第 ' + (st.idx + 1) + ' 題／共 ' + st.questions.length + ' 題</span><span class="quiz-score-line">' + (st.mock ? '⏱ <span id="mockTimer">' + fmtTime(Date.now() - st.t0) + '</span>' : 'Score: ' + st.score) + '</span></div>';
    if (q.type === "order") {
      h += '<p class="count-note">把詞依照自然語序排成句子（點方塊；點答案區可取消）</p><div class="quiz-reading">' + escapeHtml(q.zh) + '</div>' +
           '<div class="order-answer" id="orderAnswer"></div><div class="order-tiles" id="orderTiles"></div>' +
           '<div class="listen-controls"><button class="btn primary" id="orderCheck">確認</button><button class="btn" id="orderClear">清除</button></div><div id="orderResult"></div>';
    } else {
      h += q.html;
      if (q.audio) h += '<div class="listen-controls"><button class="btn primary" id="qPlay">▶ 再播放</button></div>';
      h += '<div class="quiz-options' + (q.optClass ? ' ' + q.optClass : '') + '">';
      q.options.forEach(function(opt, i){
        h += '<button class="quiz-opt" data-i="' + i + '">' + (q.hideOpts ? '<span class="qr-num">' + (i + 1) + '番</span><span class="qr-text">' + escapeHtml(opt) + '</span>' : escapeHtml(opt)) + '<span class="quiz-mark"></span></button>';
      });
      h += '</div><div id="qExplain"></div>';
    }
    h += '<div class="start-row" id="quizNextWrap" style="display:none;"><button class="btn primary" id="quizNext">下一題</button></div>';
    content.innerHTML = h;
    wireSpeakers();

    function finish(ok){
      st.answered = true;
      if (ok) { st.score++; st.secScore[q.sec || "G"]++; } else st.missed.push(q);
      document.getElementById("quizNextWrap").style.display = "block";
    }
    if (q.type !== "order") {
      if (q.audio) {
        document.getElementById("qPlay").addEventListener("click", function(){ speakSeq(q.audio); });
        speakSeq(q.audio);
      }
      var btns = content.querySelectorAll(".quiz-opt");
      btns.forEach(function(b){
        b.addEventListener("click", function(){
          if (st.answered) return;
          if (q.audio) stopSpeech();
          var chosen = q.options[parseInt(b.getAttribute("data-i"), 10)], ok = chosen === q.correct;
          btns.forEach(function(b2){
            b2.disabled = true;
            b2.classList.add("revealed");
            var o2 = q.options[parseInt(b2.getAttribute("data-i"), 10)], mk = b2.querySelector(".quiz-mark");
            if (o2 === q.correct) { b2.classList.add("correct"); mk.textContent = "◯"; }
            else if (b2 === b) { b2.classList.add("wrong"); mk.textContent = "✗"; }
          });
          if (q.after) { document.getElementById("qExplain").innerHTML = q.after; wireSpeakers(); }
          if (q.speak) speak(q.speak);
          finish(ok);
        });
      });
    } else {
      var ans = document.getElementById("orderAnswer"), tilesBox = document.getElementById("orderTiles");
      var drawOrder = function(){
        ans.innerHTML = q.picked.length ? q.picked.map(function(t, k){ return '<button class="tile picked" data-k="' + k + '">' + escapeHtml(t.w) + '</button>'; }).join("") : '<span class="field-hint">點下方的詞開始排列…</span>';
        tilesBox.innerHTML = q.tiles.map(function(t, k){ var used = q.picked.indexOf(t) !== -1; return '<button class="tile' + (used ? ' used' : '') + '" data-t="' + k + '"' + (used ? ' disabled' : '') + '>' + escapeHtml(t.w) + '</button>'; }).join("");
        tilesBox.querySelectorAll("[data-t]").forEach(function(b){ b.addEventListener("click", function(){ if (st.answered) return; q.picked.push(q.tiles[parseInt(b.getAttribute("data-t"), 10)]); drawOrder(); }); });
        ans.querySelectorAll("[data-k]").forEach(function(b){ b.addEventListener("click", function(){ if (st.answered) return; q.picked.splice(parseInt(b.getAttribute("data-k"), 10), 1); drawOrder(); }); });
      };
      drawOrder();
      document.getElementById("orderClear").addEventListener("click", function(){ if (st.answered) return; q.picked = []; drawOrder(); });
      document.getElementById("orderCheck").addEventListener("click", function(){
        if (st.answered) return;
        var got = q.picked.map(function(t){ return t.w; }).join(""), want = q.words.join(""), ok = got === want, full = want + "。";
        document.getElementById("orderResult").innerHTML = '<p class="order-verdict ' + (ok ? 'ok' : 'ng') + '">' + (ok ? '◯ 正確！' : '✗ 正確答案：') + '</p>' + afterLine(full, "");
        wireSpeakers();
        speak(full);
        finish(ok);
      });
    }
    document.getElementById("quizNext").addEventListener("click", function(){ st.idx++; st.answered = false; stopSpeech(); renderQuiz(); });
  }

  function render(){
    if (activeTab === "vocab" || activeTab === "phrase" || activeTab === "grammar") {
      renderList(activeTab);
    } else if (activeTab === "numbers") {
      renderNumbers();
    } else if (activeTab === "listening") {
      renderListening();
    } else if (activeTab === "verbs") {
      renderVerbs();
    } else if (activeTab === "patterns") {
      renderPatterns();
    } else if (activeTab === "particles") {
      renderParticles();
    } else if (activeTab === "flashcards") {
      renderFlashcards();
    } else if (activeTab === "quiz") {
      renderQuiz();
    }
  }

  // ---------- Add entry modal ----------
  var overlay = document.getElementById("modalOverlay");
  var addForm = document.getElementById("addForm");
  var editingId = null;
  function resetModal(){
    editingId = null;
    document.getElementById("modalTitle").textContent = "Add an entry";
    addForm.reset();
    document.getElementById("f-lesson").value = "";
    renderTagPicker();
  }
  function selectedTags(){
    return document.getElementById("f-lesson").value.split("|").map(function(t){ return t.trim(); }).filter(Boolean);
  }
  function setSelectedTags(arr){
    var seen = {}, out = [];
    arr.forEach(function(t){ if (t && !seen[t]) { seen[t] = true; out.push(t); } });
    out.sort(tagCompare);
    document.getElementById("f-lesson").value = out.join("|");
  }
  function renderTagPicker(){
    var picker = document.getElementById("tagPicker");
    var sel = selectedTags();
    var catalog = allTags();
    sel.forEach(function(t){ if (catalog.indexOf(t) === -1) catalog.push(t); });
    catalog.sort(tagCompare);
    picker.innerHTML = catalog.map(function(t){
      return '<button type="button" class="tag-chip pick' + (sel.indexOf(t) !== -1 ? ' active' : '') + '" data-pick="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>';
    }).join("") || '<span class="field-hint">No tags yet — add one below.</span>';
    picker.querySelectorAll("[data-pick]").forEach(function(b){
      b.addEventListener("click", function(){
        var t = b.getAttribute("data-pick"), cur = selectedTags();
        if (cur.indexOf(t) !== -1) cur = cur.filter(function(x){ return x !== t; }); else cur.push(t);
        setSelectedTags(cur);
        renderTagPicker();
      });
    });
  }
  function pickerAddNewTag(){
    var inp = document.getElementById("f-newtag");
    var t = inp.value.trim().replace(/\s+/g, " ").replace(/\|/g, "/");
    if (!t) return;
    var cur = selectedTags();
    if (cur.indexOf(t) === -1) cur.push(t);
    setSelectedTags(cur);
    inp.value = "";
    renderTagPicker();
  }
  document.getElementById("addTagBtn").addEventListener("click", pickerAddNewTag);
  document.getElementById("f-newtag").addEventListener("keydown", function(ev){ if (ev.key === "Enter") { ev.preventDefault(); pickerAddNewTag(); } });
  function openEditModal(e){
    editingId = e.id;
    document.getElementById("modalTitle").textContent = "Edit entry";
    document.getElementById("f-category").value = e.category;
    document.getElementById("f-jp").value = e.jp || "";
    document.getElementById("f-reading").value = e.reading || "";
    document.getElementById("f-meaning").value = e.meaning || "";
    document.getElementById("f-lesson").value = e.lesson || "";
    document.getElementById("f-notes").value = e.notes || "";
    renderTagPicker();
    overlay.classList.remove("hidden");
  }
  document.getElementById("addFab").addEventListener("click", function(){
    resetModal();
    var catField = document.getElementById("f-category");
    if (activeTab === "vocab" || activeTab === "phrase" || activeTab === "grammar") catField.value = activeTab;
    overlay.classList.remove("hidden");
    document.getElementById("f-jp").focus();
  });
  document.getElementById("cancelAdd").addEventListener("click", function(){ overlay.classList.add("hidden"); resetModal(); });
  overlay.addEventListener("click", function(e){ if (e.target === overlay) { overlay.classList.add("hidden"); resetModal(); } });

  addForm.addEventListener("submit", function(e){
    e.preventDefault();
    var entry = {
      id: "u-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      category: document.getElementById("f-category").value,
      jp: document.getElementById("f-jp").value.trim(),
      reading: document.getElementById("f-reading").value.trim(),
      meaning: document.getElementById("f-meaning").value.trim(),
      lesson: document.getElementById("f-lesson").value.trim(),
      notes: document.getElementById("f-notes").value.trim()
    };
    if (!entry.jp || !entry.meaning) return;
    if (editingId) {
      var fields = {category: entry.category, jp: entry.jp, reading: entry.reading, meaning: entry.meaning, lesson: entry.lesson, notes: entry.notes};
      if (seedById[editingId]) {
        userState.overrides[editingId] = fields;
      } else {
        userState.added.forEach(function(u){ if (u.id === editingId) { for (var k in fields) u[k] = fields[k]; } });
      }
      var savedId = editingId;
      saveUserState();
      refreshEntries();
      overlay.classList.add("hidden");
      resetModal();
      render();
      var ed = entriesById(savedId);
      if (ed) openDetail(ed);
      return;
    }
    userState.added.push(entry);
    saveUserState();
    refreshEntries();
    overlay.classList.add("hidden");
    resetModal();
    if (entry.category !== activeTab) {
      activeTab = entry.category;
      Array.prototype.forEach.call(tabsNav.querySelectorAll("button"), function(b){
        b.classList.toggle("active", b.getAttribute("data-tab") === activeTab);
      });
    }
    searchText = "";
    tagFilter = "";
    render();
  });

  // ---------- Footer actions ----------
  function updateFooterCount(){
    document.getElementById("totalCount").textContent = entries.length + " total entries";
  }
  document.getElementById("restoreBtn").addEventListener("click", function(){
    if (!userState.deletedSeedIds.length) { alert("Starter set is already complete in your notebook."); return; }
    userState.deletedSeedIds = [];
    saveUserState();
    refreshEntries();
    render();
  });
  document.getElementById("resetEditsBtn").addEventListener("click", function(){
    var n = Object.keys(userState.overrides || {}).length;
    if (!n) { alert("You have no edits to undo."); return; }
    if (confirm("Undo your " + n + " edit(s) to starter words and restore their original text and tags?")) {
      userState.overrides = {};
      saveUserState();
      refreshEntries();
      render();
    }
  });
  document.getElementById("clearBtn").addEventListener("click", function(){
    if (confirm("This removes everything you've added and restores the full starter set. Continue?")) {
      userState = {added: [], deletedSeedIds: [], overrides: {}};
      saveUserState();
      refreshEntries();
      fcState = { filter: "all", deck: [], pos: 0, flipped: false };
      quizState = null;
      render();
    }
  });

  render();
})();
