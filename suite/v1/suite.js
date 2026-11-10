/* Copyright 2026 Nithish Seenivasagam (coderenewables.com). SPDX-License-Identifier: Apache-2.0
 * CodeRenewables suite client: one shared project for WindNudge, SolarNudge, LossStack and WattOdds.
 * Protocol v1 is frozen (see README.md). No dependencies. Must never throw at load time.
 * The hub page (hub.html) loads this file too, and uses only the storage core below. */
(function () {
  'use strict';
  if (window.CRSuite) return;

  var TECHS = ['wind', 'solar', 'hybrid'];
  var SECTIONS = ['windnudge', 'solarnudge', 'lossstack', 'wattodds'];
  var MAX_VALUE = 400000;
  var INDEX_KEY = 'cr-suite:index:v1';
  var PROJECT_PREFIX = 'cr-suite:project:';
  var DEFAULT_NAME = 'Untitled project';
  var ID_RE = /^p-[a-z0-9]{1,40}$/;

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function nowIso() { return new Date().toISOString(); }
  function newId() { return 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function validId(id) { return typeof id === 'string' && ID_RE.test(id); }
  function isQuota(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
  }

  /* Storage core. getStorage() returns the Storage object to use (the hub's or the tool's own).
   * run(op, args) returns { ok, result } or { ok: false, error }, plus change: { projectId, section } or null.
   * Every operation is synchronous, so each one is a single read-modify-write. */
  function createStore(getStorage) {
    function ok(result, change) { return { ok: true, result: result, change: change || null }; }
    function fail(error) { return { ok: false, error: error, change: null }; }

    function readJson(key) {
      var raw = getStorage().getItem(key);
      if (raw === null) return null;
      try { var v = JSON.parse(raw); return isObj(v) ? v : null; } catch (e) { return null; }
    }
    function readIndex() {
      var idx = readJson(INDEX_KEY) || {};
      var projects = {};
      if (isObj(idx.projects)) {
        Object.keys(idx.projects).forEach(function (id) {
          var e = idx.projects[id];
          if (validId(id) && isObj(e) && typeof e.name === 'string' && TECHS.indexOf(e.tech) >= 0 && typeof e.updated === 'string') {
            projects[id] = e;
          }
        });
      }
      var currentId = typeof idx.currentId === 'string' && hasOwn(projects, idx.currentId) ? idx.currentId : null;
      return { currentId: currentId, projects: projects };
    }
    function writeIndex(idx) { getStorage().setItem(INDEX_KEY, JSON.stringify(idx)); }
    function readProject(id) {
      var p = readJson(PROJECT_PREFIX + id);
      return p && p.id === id && isObj(p.sections) ? p : null;
    }
    function writeProject(p) { getStorage().setItem(PROJECT_PREFIX + p.id, JSON.stringify(p)); }
    function cleanName(v, withDefault) {
      if (v === undefined || v === null || v === '') return withDefault ? DEFAULT_NAME : null;
      if (typeof v !== 'string') return null;
      var s = v.trim();
      if (!s) return withDefault ? DEFAULT_NAME : null;
      return s.length <= 120 ? s : null;
    }
    function validSection(s) { return typeof s === 'string' && SECTIONS.indexOf(s) >= 0; }

    var ops = {
      ping: function () { return ok({ version: 1 }); },

      list: function () {
        var idx = readIndex();
        var projects = Object.keys(idx.projects).map(function (id) {
          var e = idx.projects[id];
          return { id: id, name: e.name, tech: e.tech, updated: e.updated };
        });
        projects.sort(function (a, b) { return a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0; });
        return ok({ currentId: idx.currentId, projects: projects });
      },

      get: function (a) {
        if (!validId(a.id)) return fail('bad_args');
        if (!hasOwn(readIndex().projects, a.id)) return fail('not_found');
        var p = readProject(a.id);
        return p ? ok(p) : fail('not_found');
      },

      create: function (a) {
        if (TECHS.indexOf(a.tech) < 0) return fail('bad_args');
        var name = cleanName(a.name, true);
        if (name === null) return fail('bad_args');
        var id = newId();
        var t = nowIso();
        var p = { schema: 'cr-suite/1', id: id, name: name, tech: a.tech, created: t, updated: t, rev: 0, sections: {} };
        writeProject(p);
        var idx = readIndex();
        idx.projects[id] = { name: name, tech: a.tech, updated: t };
        idx.currentId = id;
        writeIndex(idx);
        return ok(p, { projectId: id, section: null });
      },

      rename: function (a) {
        if (!validId(a.id)) return fail('bad_args');
        var name = cleanName(a.name, false);
        if (name === null) return fail('bad_args');
        var idx = readIndex();
        var p = hasOwn(idx.projects, a.id) ? readProject(a.id) : null;
        if (!p) return fail('not_found');
        p.rev = (p.rev || 0) + 1;
        p.name = name;
        p.updated = nowIso();
        writeProject(p);
        idx.projects[a.id].name = name;
        idx.projects[a.id].updated = p.updated;
        writeIndex(idx);
        return ok({ id: a.id, name: name }, { projectId: a.id, section: null });
      },

      remove: function (a) {
        if (!validId(a.id)) return fail('bad_args');
        var idx = readIndex();
        if (!hasOwn(idx.projects, a.id)) return fail('not_found');
        getStorage().removeItem(PROJECT_PREFIX + a.id);
        delete idx.projects[a.id];
        if (idx.currentId === a.id) idx.currentId = null;
        writeIndex(idx);
        return ok({ id: a.id }, { projectId: a.id, section: null });
      },

      setCurrent: function (a) {
        var id = a.id === undefined ? null : a.id;
        var idx = readIndex();
        if (id !== null) {
          if (!validId(id)) return fail('bad_args');
          if (!hasOwn(idx.projects, id)) return fail('not_found');
        }
        idx.currentId = id;
        writeIndex(idx);
        return ok({ currentId: id }, { projectId: null, section: null });
      },

      write: function (a) {
        if (!validId(a.id) || !validSection(a.section)) return fail('bad_args');
        var txt;
        try { txt = JSON.stringify(a.value); } catch (e) { txt = undefined; }
        if (typeof txt !== 'string') return fail('bad_args');
        if (txt.length > MAX_VALUE) return fail('too_large');
        var idx = readIndex();
        var p = hasOwn(idx.projects, a.id) ? readProject(a.id) : null;
        if (!p) return fail('not_found');
        var t = nowIso();
        p.rev = (p.rev || 0) + 1;
        p.sections[a.section] = { rev: p.rev, updated: t, value: JSON.parse(txt) };
        p.updated = t;
        writeProject(p);
        idx.projects[a.id].updated = t;
        writeIndex(idx);
        return ok({ rev: p.rev, sectionRev: p.rev, updated: t }, { projectId: a.id, section: a.section });
      },

      clearSection: function (a) {
        if (!validId(a.id) || !validSection(a.section)) return fail('bad_args');
        var idx = readIndex();
        var p = hasOwn(idx.projects, a.id) ? readProject(a.id) : null;
        if (!p) return fail('not_found');
        var t = nowIso();
        p.rev = (p.rev || 0) + 1;
        delete p.sections[a.section];
        p.updated = t;
        writeProject(p);
        idx.projects[a.id].updated = t;
        writeIndex(idx);
        return ok({ rev: p.rev }, { projectId: a.id, section: a.section });
      }
    };

    function run(op, args) {
      var a = isObj(args) ? args : {};
      if (typeof op !== 'string' || !hasOwn(ops, op)) return fail('bad_args');
      try { return ops[op](a); } catch (e) { return fail(isQuota(e) ? 'quota' : 'failed'); }
    }

    return { run: run, PROJECT_PREFIX: PROJECT_PREFIX, INDEX_KEY: INDEX_KEY, SECTIONS: SECTIONS };
  }

  // The hub page loads this file only for the storage core.
  if (window.CR_SUITE_HUB_PAGE === true) {
    window.CRSuite = { _core: { createStore: createStore } };
    return;
  }

  /* ---------- client ---------- */

  var TOOLS = {
    windnudge: 'https://windnudge.coderenewables.com/',
    solarnudge: 'https://solarnudge.coderenewables.com/',
    lossstack: 'https://lossstack.coderenewables.com/',
    wattodds: 'https://wattodds.coderenewables.com/app/'
  };
  var TOOL_LABEL = { windnudge: 'WindNudge', solarnudge: 'SolarNudge', lossstack: 'LossStack', wattodds: 'WattOdds' };
  var PIPE = {
    wind: ['windnudge', 'lossstack', 'wattodds'],
    solar: ['solarnudge', 'lossstack', 'wattodds'],
    hybrid: ['wattodds']
  };
  var HUB_URL = typeof window.CR_SUITE_HUB === 'string' ? window.CR_SUITE_HUB : 'https://coderenewables.com/suite/v1/hub.html';
  var hubOrigin = null;
  try { hubOrigin = new URL(HUB_URL).origin; } catch (e) { hubOrigin = null; }

  var toolUrls = {};
  Object.keys(TOOLS).forEach(function (k) { toolUrls[k] = TOOLS[k]; });
  if (isObj(window.CR_SUITE_TOOLS)) {
    Object.keys(window.CR_SUITE_TOOLS).forEach(function (k) {
      if (hasOwn(TOOLS, k) && typeof window.CR_SUITE_TOOLS[k] === 'string') toolUrls[k] = window.CR_SUITE_TOOLS[k];
    });
  }

  var STARTUP_MS = 2000;
  var REQUEST_MS = 4000;
  var DEBOUNCE_MS = 100;

  var mode = 'pending';           // 'pending' | 'shared' | 'local'
  var store = null;               // local store (local mode only)
  var frame = null;               // hidden hub iframe (shared mode only)
  var nextReq = 1;
  var pending = {};
  var startTimer = null;
  var readyResolve = null;
  var readyPromise = new Promise(function (resolve) { readyResolve = resolve; });
  var state = { currentId: null, project: null, curRev: null, list: [], notice: null };
  var ui = { mode: null, tech: null, draft: '', focus: false };
  var listeners = [];
  var bars = [];
  var inflight = 0;
  var refreshTimer = null;
  var pendingSection = null;

  function coded(code) { var e = new Error(code); e.code = code; return e; }
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function btn(label, onClick, cls) {
    var b = el('button', { type: 'button', class: cls || 'crs-btn' }, label);
    b.addEventListener('click', onClick);
    return b;
  }
  function formatWhen(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return 'time unknown';
      return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return 'time unknown'; }
  }
  function errText(e) {
    var c = e && e.code;
    if (c === 'quota') return 'Could not save: this browser’s storage is full.';
    if (c === 'timeout') return 'Suite storage did not answer. Try again.';
    if (c === 'too_large') return 'That is too large to save to the project.';
    if (c === 'not_found') return 'That project is not in this browser.';
    if (c === 'bad_args') return 'That name is not valid. Use 1 to 120 characters.';
    if (c === 'no_project') return 'Open or create a project first.';
    return 'Could not save this change.';
  }
  function toolUrl(tool, id) {
    var base = hasOwn(toolUrls, tool) ? toolUrls[tool] : null;
    if (!base) return null;
    try {
      var u = new URL(base);
      if (id) u.searchParams.set('project', id);
      return u.href;
    } catch (e) { return null; }
  }
  function urlProject() {
    try {
      var v = new URL(location.href).searchParams.get('project');
      return validId(v) ? v : null;
    } catch (e) { return null; }
  }
  function setUrl(id) {
    try {
      var u = new URL(location.href);
      if (id) u.searchParams.set('project', id); else u.searchParams.delete('project');
      if (u.href !== location.href) history.replaceState(history.state, '', u.href);
    } catch (e) { /* file:// or sandboxed page: keep the URL as it is */ }
  }

  /* Transport. sendShared talks to the hub; rpc picks hub or local store by mode. */
  function sendShared(op, args) {
    return new Promise(function (resolve, reject) {
      var id = nextReq++;
      var timer = setTimeout(function () { delete pending[id]; reject(coded('timeout')); }, REQUEST_MS);
      pending[id] = function (m) {
        clearTimeout(timer);
        delete pending[id];
        resolve(m.ok ? { ok: true, result: m.result } : { ok: false, error: m.error || 'failed' });
      };
      try {
        frame.contentWindow.postMessage({ crSuite: 1, id: id, op: op, args: args || {} }, hubOrigin);
      } catch (e) {
        clearTimeout(timer);
        delete pending[id];
        reject(coded('failed'));
      }
    });
  }
  function rpc(op, args) {
    if (mode === 'shared') return sendShared(op, args);
    return Promise.resolve(store.run(op, args || {}));
  }
  // call: resolves with the result or rejects with an Error whose .code is the protocol error.
  function call(op, args) {
    return rpc(op, args).then(function (r) {
      if (r.ok) return r.result;
      throw coded(r.error);
    });
  }
  function request(op, args) {
    return readyPromise.then(function () { return call(op, args); });
  }

  /* Start-up: shared if the hub answers ping in time, otherwise local. */
  function startup() {
    try {
      if (!hubOrigin) return goLocal();
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', startup, { once: true });
        return;
      }
      frame = el('iframe', { title: 'Suite storage', 'aria-hidden': 'true' });
      frame.style.display = 'none';
      frame.addEventListener('load', function () {
        if (mode !== 'pending' || !frame) return;
        sendShared('ping', {}).then(function (r) {
          if (r.ok && mode === 'pending') goShared();
        }, function () { /* the start-up timer decides */ });
      });
      frame.addEventListener('error', goLocal);
      frame.src = HUB_URL;
      startTimer = setTimeout(goLocal, STARTUP_MS);
      document.body.appendChild(frame);
    } catch (e) {
      goLocal();
    }
  }
  function goShared() {
    if (mode !== 'pending') return;
    mode = 'shared';
    clearTimeout(startTimer);
    init();
  }
  function goLocal() {
    if (mode !== 'pending') return;
    mode = 'local';
    clearTimeout(startTimer);
    try { if (frame && frame.parentNode) frame.parentNode.removeChild(frame); } catch (e) { /* ignore */ }
    frame = null;
    store = createStore(function () { return window.localStorage; });
    init();
  }

  function init() {
    var urlId = urlProject();
    call('list').then(function (l) {
      state.list = l.projects;
      var want = l.currentId;
      var unknown = false;
      if (urlId) {
        if (l.projects.some(function (p) { return p.id === urlId; })) want = urlId;
        else unknown = true;
      }
      var set = want !== l.currentId ? call('setCurrent', { id: want }) : Promise.resolve(null);
      return set.then(function () {
        return want ? call('get', { id: want }).catch(function () { return null; }) : null;
      }).then(function (p) {
        state.currentId = p ? p.id : null;
        state.project = p;
        state.curRev = p ? p.rev : null;
        if (unknown) state.notice = { text: 'That project is not in this browser.', action: null, onAction: null };
        if (urlId !== state.currentId) setUrl(state.currentId);
      });
    }).catch(function () {
      /* storage answered but could not be read: start with no project */
    }).then(function () {
      renderBars();
      readyResolve({ mode: mode });
    });
  }

  /* Own changes and changes from other pages. */
  function fire(project, section, own) {
    var ev = { project: project, section: section || null, own: !!own };
    listeners.slice().forEach(function (fn) {
      try { fn(ev); } catch (e) { if (window.console) console.error(e); }
    });
  }
  function adopt(project, section, own) {
    var id = project ? project.id : null;
    var switched = id !== state.currentId;
    var changedNow = switched || (project !== null && project.rev !== state.curRev);
    if (switched) {
      state.notice = null;
      ui = { mode: null, tech: null, draft: '', focus: false };
    }
    state.currentId = id;
    state.project = project;
    state.curRev = project ? project.rev : null;
    if (changedNow) fire(project, section, own);
    renderBars();
  }
  function refreshList() {
    return request('list').then(function (l) {
      state.list = l.projects;
      renderBars();
    }).catch(function () { /* the bar keeps its last list */ });
  }
  // inflight keeps the hub-event refresh from racing our own writes.
  function tracked(fn) {
    inflight++;
    return Promise.resolve().then(fn).then(function (r) {
      inflight--;
      refreshList();
      return r;
    }, function (e) {
      inflight--;
      throw e;
    });
  }
  function changedSection(before, after) {
    var found = null;
    SECTIONS.forEach(function (name) {
      var a = hasOwn(after.sections, name) ? after.sections[name] : null;
      var b = hasOwn(before.sections, name) ? before.sections[name] : null;
      var aRev = isObj(a) ? a.rev : null;
      var bRev = isObj(b) ? b.rev : null;
      if (aRev !== bRev) found = name;
    });
    return found;
  }
  function scheduleRefresh(section) {
    if (section) pendingSection = section;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshNow, DEBOUNCE_MS);
  }
  function refreshNow() {
    refreshTimer = null;
    if (inflight > 0) { refreshTimer = setTimeout(refreshNow, DEBOUNCE_MS); return; }
    var section = pendingSection;
    pendingSection = null;
    request('list').then(function (l) {
      state.list = l.projects;
      if (!l.currentId) {
        if (state.currentId !== null) adopt(null, section, false); else renderBars();
        return null;
      }
      return request('get', { id: l.currentId }).then(function (p) {
        var sameStale = l.currentId === state.currentId && state.curRev !== null && p.rev <= state.curRev;
        if (sameStale) { renderBars(); return; }
        // Hub events from another tab carry no section name, so find it from the section revisions.
        if (!section && state.project && state.project.id === p.id) section = changedSection(state.project, p);
        adopt(p, section, false);
      }, function (e) {
        if (e && e.code === 'not_found') adopt(null, section, false); else renderBars();
      });
    }).catch(function () { renderBars(); });
  }

  /* Messages from the hub. Only the hub iframe's window and origin are accepted. */
  function onMessage(event) {
    try {
      if (!frame || event.source !== frame.contentWindow || event.origin !== hubOrigin) return;
      var m = event.data;
      if (!isObj(m) || m.crSuite !== 1) return;
      if (m.event === 'changed') { scheduleRefresh(typeof m.section === 'string' ? m.section : null); return; }
      if (typeof m.id === 'number' && hasOwn(pending, m.id)) pending[m.id](m);
    } catch (e) { /* ignore malformed messages */ }
  }

  /* ---------- project bar ---------- */

  var STYLE = [
    '.crs-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;box-sizing:border-box;width:100%;max-width:100%;padding:8px 16px;background:var(--surface,#fff);border-bottom:1px solid var(--line,#d5dde0);color:var(--ink,#10212a);font:13px/1.4 var(--f-body,system-ui,sans-serif)}',
    '.crs-bar *{box-sizing:border-box}',
    '.crs-bar select,.crs-bar input{font:inherit;color:inherit;background:var(--surface,#fff);border:1px solid var(--line-2,#9fb0b6);border-radius:6px;padding:5px 8px;max-width:100%}',
    '.crs-bar select{max-width:min(20rem,100%)}',
    '.crs-bar input{width:min(16rem,100%)}',
    '.crs-btn{font:inherit;color:inherit;background:var(--surface,#fff);border:1px solid var(--line-2,#9fb0b6);border-radius:6px;padding:5px 10px;cursor:pointer}',
    '.crs-btn.primary{background:var(--accent,#1f6f78);color:var(--accent-ink,#fff);border-color:var(--accent,#1f6f78)}',
    '.crs-bar button:focus-visible,.crs-bar select:focus-visible,.crs-bar input:focus-visible,.crs-bar a:focus-visible{outline:2px solid var(--accent,#1f6f78);outline-offset:2px}',
    '.crs-form{display:inline-flex;flex-wrap:wrap;gap:6px;align-items:center;max-width:100%}',
    '.crs-pipe{display:flex;flex-wrap:wrap;gap:6px;align-items:center;list-style:none;margin:0;padding:0}',
    '.crs-pipe li{display:flex;align-items:center;gap:6px;min-width:0}',
    '.crs-pipe li+li::before{content:"\\2192";color:var(--ink-3,#60727a)}',
    '.crs-chip{position:relative;display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid var(--line-2,#9fb0b6);color:inherit;text-decoration:none;white-space:nowrap}',
    'a.crs-chip:hover{background:var(--accent-wash,#e8f1f2)}',
    '.crs-chip[aria-current]{background:var(--accent-wash,#e8f1f2);font-weight:600}',
    '.crs-dot{display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px solid currentColor}',
    '.crs-dot.on{background:currentColor}',
    '.crs-notice{margin-left:auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0;max-width:100%}',
    '.crs-mode{color:var(--ink-3,#60727a)}',
    '.crs-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '@media print{.crs-bar{display:none!important}}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById('crs-style')) return;
    var s = el('style', { id: 'crs-style' });
    s.textContent = STYLE;
    (document.head || document.documentElement).appendChild(s);
  }

  function notify(text, opts) {
    opts = isObj(opts) ? opts : {};
    state.notice = {
      text: String(text),
      action: typeof opts.action === 'string' ? opts.action : null,
      onAction: typeof opts.onAction === 'function' ? opts.onAction : null
    };
    renderBars();
  }

  function renderBars() {
    bars = bars.filter(function (b) { return b.el.isConnected; });
    bars.forEach(renderBar);
    var f = document.querySelector('.crs-bar [data-crs-focus]');
    if (ui.focus && f) f.focus();
    ui.focus = false;
  }

  function onPick(v) {
    if (v === '__new_wind' || v === '__new_solar') {
      ui = { mode: 'new', tech: v === '__new_wind' ? 'wind' : 'solar', draft: '', focus: true };
      renderBars();
      return;
    }
    if (v === '__delete') {
      ui = { mode: 'delete', tech: null, draft: '', focus: true };
      renderBars();
      return;
    }
    ui = { mode: null, tech: null, draft: '', focus: false };
    if (!v || v === state.currentId) { renderBars(); return; }
    CRSuite.open(v).catch(function (e) { notify(errText(e)); });
  }

  function pipeline(tool, p) {
    var ol = el('ol', { class: 'crs-pipe', 'aria-label': 'Suite pipeline' });
    (PIPE[p.tech] || []).forEach(function (t) {
      var sec = hasOwn(p.sections, t) ? p.sections[t] : null;
      var has = isObj(sec);
      var when = has ? 'Updated ' + formatWhen(sec.updated) : 'Nothing saved yet';
      var label = document.createTextNode(TOOL_LABEL[t]);
      var parts = [
        el('span', { class: 'crs-dot' + (has ? ' on' : ''), 'aria-hidden': 'true' }),
        label,
        el('span', { class: 'crs-sr' }, has ? ', saved' : ', not saved yet')
      ];
      var li = el('li');
      var node;
      if (t === tool) {
        node = el('span', { class: 'crs-chip', 'aria-current': 'page', title: when });
      } else {
        node = el('a', { class: 'crs-chip', href: toolUrl(t, p.id) || '#', target: '_self', title: when });
      }
      parts.forEach(function (n) { node.appendChild(n); });
      li.appendChild(node);
      ol.appendChild(li);
    });
    return ol;
  }

  function renderBar(b) {
    var bar = b.el;
    bar.textContent = '';
    var p = state.project;

    var sel = el('select', { class: 'crs-select', 'aria-label': 'Project' });
    if (!state.currentId) sel.appendChild(el('option', { value: '' }, 'No project'));
    state.list.forEach(function (x) { sel.appendChild(el('option', { value: x.id }, x.name)); });
    sel.appendChild(el('option', { value: '__new_wind' }, 'New wind project…'));
    sel.appendChild(el('option', { value: '__new_solar' }, 'New solar project…'));
    if (state.currentId) sel.appendChild(el('option', { value: '__delete' }, 'Delete this project…'));
    sel.value = state.currentId || '';
    sel.addEventListener('change', function () { onPick(sel.value); });
    bar.appendChild(sel);

    if (p && ui.mode !== 'rename') {
      bar.appendChild(btn('Rename', function () {
        ui = { mode: 'rename', tech: null, draft: p.name, focus: true };
        renderBars();
      }));
    }

    if (ui.mode === 'rename' && p) bar.appendChild(renameForm());
    if (ui.mode === 'new') bar.appendChild(newForm());
    if (ui.mode === 'delete' && p) bar.appendChild(deleteRow(p));
    if (p) bar.appendChild(pipeline(b.tool, p));

    var note = el('div', { class: 'crs-notice', role: 'status' });
    if (mode === 'local') note.appendChild(el('span', { class: 'crs-mode' }, 'Saved in this tool only'));
    if (state.notice) {
      var n = state.notice;
      note.appendChild(el('span', null, n.text));
      if (n.action) {
        note.appendChild(btn(n.action, function () {
          var cb = state.notice && state.notice.onAction;
          state.notice = null;
          renderBars();
          if (cb) { try { cb(); } catch (e) { if (window.console) console.error(e); } }
        }, 'crs-btn primary'));
      }
      note.appendChild(btn('×', function () { state.notice = null; renderBars(); }));
      note.lastChild.setAttribute('aria-label', 'Dismiss notice');
    }
    bar.appendChild(note);
  }

  function renameForm() {
    var wrap = el('span', { class: 'crs-form' });
    var input = el('input', { type: 'text', maxlength: '120', 'aria-label': 'Project name', 'data-crs-focus': '' });
    input.value = ui.draft;
    input.addEventListener('input', function () { ui.draft = input.value; });
    function save() {
      var name = (ui.draft || '').trim();
      if (!name) { notify('Enter a project name.'); return; }
      var id = state.currentId;
      ui = { mode: null, tech: null, draft: '', focus: false };
      CRSuite.rename(id, name).catch(function (e) { notify(errText(e)); });
    }
    function cancel() { ui = { mode: null, tech: null, draft: '', focus: false }; renderBars(); }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    wrap.appendChild(input);
    wrap.appendChild(btn('Save', save, 'crs-btn primary'));
    wrap.appendChild(btn('Cancel', cancel));
    return wrap;
  }

  function newForm() {
    var tech = ui.tech;
    var wrap = el('span', { class: 'crs-form' });
    var input = el('input', {
      type: 'text', maxlength: '120', placeholder: 'Project name',
      'aria-label': (tech === 'wind' ? 'New wind project name' : 'New solar project name'), 'data-crs-focus': ''
    });
    input.value = ui.draft;
    input.addEventListener('input', function () { ui.draft = input.value; });
    function create() {
      var name = (ui.draft || '').trim();
      ui = { mode: null, tech: null, draft: '', focus: false };
      CRSuite.create({ name: name || undefined, tech: tech }).catch(function (e) { notify(errText(e)); });
    }
    function cancel() { ui = { mode: null, tech: null, draft: '', focus: false }; renderBars(); }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); create(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    wrap.appendChild(input);
    wrap.appendChild(btn('Create', create, 'crs-btn primary'));
    wrap.appendChild(btn('Cancel', cancel));
    return wrap;
  }

  function deleteRow(p) {
    var wrap = el('span', { class: 'crs-form' });
    wrap.appendChild(el('span', null, 'Delete “' + p.name + '”?'));
    wrap.appendChild(btn('Delete', function () {
      var id = p.id;
      ui = { mode: null, tech: null, draft: '', focus: false };
      CRSuite.remove(id).catch(function (e) { notify(errText(e)); });
    }));
    var keep = btn('Keep', function () { ui = { mode: null, tech: null, draft: '', focus: false }; renderBars(); });
    keep.setAttribute('data-crs-focus', '');
    ui.focus = true;
    wrap.appendChild(keep);
    return wrap;
  }

  function mountBar(opts) {
    opts = isObj(opts) ? opts : {};
    injectStyle();
    var bar = el('div', { class: 'crs-bar', role: 'region', 'aria-label': 'Suite project' });
    var after = opts.after && opts.after.parentNode ? opts.after : null;
    if (after) after.parentNode.insertBefore(bar, after.nextSibling);
    else document.body.insertBefore(bar, document.body.firstChild);
    var b = { el: bar, tool: hasOwn(TOOL_LABEL, opts.tool) ? opts.tool : null };
    bars.push(b);
    renderBar(b);
    return bar;
  }

  /* ---------- public API ---------- */

  var CRSuite = {
    ready: readyPromise,

    get mode() { return mode; },

    list: function () {
      return request('list').then(function (l) {
        state.list = l.projects;
        renderBars();
        return l;
      });
    },

    current: function () {
      return request('list').then(function (l) {
        if (!l.currentId) return null;
        return request('get', { id: l.currentId }).catch(function (e) {
          if (e && e.code === 'not_found') return null;
          throw e;
        });
      });
    },

    open: function (id) {
      if (id === null) {
        return tracked(function () {
          return request('setCurrent', { id: null }).then(function () {
            adopt(null, null, true);
            setUrl(null);
            return null;
          });
        });
      }
      return tracked(function () {
        return request('get', { id: id }).then(function (p) {
          return request('setCurrent', { id: p.id }).then(function () {
            adopt(p, null, true);
            setUrl(p.id);
            return p;
          });
        });
      });
    },

    create: function (args) {
      args = isObj(args) ? args : {};
      return tracked(function () {
        return request('create', { name: args.name, tech: args.tech }).then(function (p) {
          adopt(p, null, true);
          setUrl(p.id);
          return p;
        });
      });
    },

    rename: function (id, name) {
      return tracked(function () {
        return request('rename', { id: id, name: name }).then(function (r) {
          if (id !== state.currentId) return r;
          return request('get', { id: id }).then(function (p) {
            if (state.currentId === id) adopt(p, null, true);
            return r;
          }, function () { return r; });
        });
      });
    },

    remove: function (id) {
      return tracked(function () {
        var was = id === state.currentId;
        return request('remove', { id: id }).then(function (r) {
          if (was) { adopt(null, null, true); setUrl(null); }
          return r;
        });
      });
    },

    write: function (section, value) {
      if (!state.currentId) return Promise.reject(coded('no_project'));
      var id = state.currentId;
      return tracked(function () {
        return request('write', { id: id, section: section, value: value }).then(function (r) {
          return request('get', { id: id }).then(function (p) {
            if (state.currentId === id) adopt(p, section, true);
            return r;
          });
        });
      });
    },

    clearSection: function (section) {
      if (!state.currentId) return Promise.reject(coded('no_project'));
      var id = state.currentId;
      return tracked(function () {
        return request('clearSection', { id: id, section: section }).then(function (r) {
          return request('get', { id: id }).then(function (p) {
            if (state.currentId === id) adopt(p, section, true);
            return r;
          });
        });
      });
    },

    section: function (project, name) {
      if (!project || SECTIONS.indexOf(name) < 0 || !hasOwn(project.sections || {}, name)) return null;
      var s = project.sections[name];
      return s ? s.value : null;
    },

    onChange: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },

    mountBar: function (opts) {
      try { return mountBar(opts); } catch (e) { return null; }
    },

    notice: function (text, opts) { notify(text, opts); },

    toolUrl: toolUrl
  };

  window.CRSuite = CRSuite;

  try {
    window.addEventListener('message', onMessage);
    window.addEventListener('storage', function (e) {
      if (e && typeof e.key === 'string' && e.key.indexOf('cr-suite:') === 0) scheduleRefresh(null);
    });
    startup();
  } catch (e) {
    goLocal();
  }

  // Test hook: expose the core store for the test page only (never on a live site).
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.__crSuiteTest = { store: createStore };
  }
})();
