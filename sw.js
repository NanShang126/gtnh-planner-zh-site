/* GTNH Planner 静态克隆版 Service Worker
 * 职责:
 * 1. 拦截 /api/datasets/* 请求,用本地静态数据模拟线上 API
 * 2. 代理 /datasets/、/nei/ 下的纹理到线上源站并缓存
 * 3. app shell (_next chunks) 缓存优先
 */
"use strict";

var BASE = "/gtnh-planner-zh";
var LIVE_ORIGIN = "https://gtnhplanner.com";
var DATA = BASE + "/data/";
var SHARD_PATH = BASE + "/datasets/gtnh/local-2.9.0-beta-2/recipes-shards/";

var CACHE_SHELL = "gtnh-shell-v3";

var mem = {
  summaries: null,
  idToIdx: null,
  idxMakes: null,
  idxTakes: null,
  idxSource: null,
  recipeIds: null,
  resources: null,
  resLower: null,
  catalog: null,
  crops: null,
  mobs: null,
  shards: new Map(),
  loading: {},
};

/* ---------- 工具 ---------- */
function jsonResponse(obj, status) {
  var body = JSON.stringify(obj);
  return new Response(body, {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

function loadGzJson(url) {
  if (mem.loading[url]) return mem.loading[url];
  mem.loading[url] = fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error("load fail " + url + " " + r.status);
      return r.body.pipeThrough(new DecompressionStream("gzip"));
    })
    .then(function (s) { return new Response(s).json(); })
    .catch(function (e) { delete mem.loading[url]; throw e; });
  return mem.loading[url];
}

function getSummaries() {
  if (mem.summaries) return Promise.resolve(mem.summaries);
  return loadGzJson(DATA + "summaries.json.gz").then(function (s) {
    mem.summaries = s;
    var m = new Map();
    var ids = s.ids;
    for (var i = 0; i < ids.length; i++) m.set(ids[i], i);
    mem.idToIdx = m;
    return s;
  });
}

function getIdx(name) {
  if (name === "makes") {
    if (mem.idxMakes) return Promise.resolve(mem.idxMakes);
    return loadGzJson(DATA + "idx_makes.json.gz").then(function (d) { mem.idxMakes = d; return d; });
  }
  if (mem.idxTakes) return Promise.resolve(mem.idxTakes);
  return loadGzJson(DATA + "idx_takes.json.gz").then(function (d) { mem.idxTakes = d; return d; });
}

function getIdxSource() {
  if (mem.idxSource) return Promise.resolve(mem.idxSource);
  return loadGzJson(DATA + "idx_source.json.gz").then(function (d) { mem.idxSource = d; return d; });
}

function getResources() {
  if (mem.resources) return Promise.resolve(mem.resources);
  return loadGzJson(DATA + "resources.json.gz").then(function (d) {
    mem.resources = d;
    var lo = new Array(d.length);
    for (var i = 0; i < d.length; i++) lo[i] = (d[i].displayName || "").toLowerCase();
    mem.resLower = lo;
    return d;
  });
}

function getCatalog() {
  if (mem.catalog) return Promise.resolve(mem.catalog);
  return fetch(DATA + "catalog.json").then(function (r) { return r.json(); })
    .then(function (d) { mem.catalog = d; return d; });
}

function getShard(idx) {
  idx = Number(idx);
  if (mem.shards.has(idx)) return Promise.resolve(mem.shards.get(idx));
  var url = SHARD_PATH + "shard-" + String(idx).padStart(4, "0") + ".json.gz";
  return loadGzJson(url).then(function (d) {
    var list = d.recipes || [];
    mem.shards.set(idx, list);
    return list;
  });
}

function getRecipeById(id) {
  return getSummaries().then(function (s) {
    var i = mem.idToIdx.get(id);
    if (i === undefined) return null;
    return getShard(s.shardIndex[i]).then(function (list) {
      for (var j = 0; j < list.length; j++) if (list[j].id === id) return list[j];
      return null;
    });
  });
}

/* ---------- /resources 模拟 ---------- */
function modOf(id) {
  var i = id.indexOf(":");
  return i > 0 ? id.slice(0, i) : id;
}

function handleResources(params) {
  var query = (params.get("query") || "").trim().toLowerCase();
  var offset = parseInt(params.get("offset") || "0", 10) || 0;
  var limit = parseInt(params.get("limit") || "30", 10) || 30;
  var kind = params.get("kind");
  var source = params.get("source");
  var sort = params.get("sort") || "popular";

  return Promise.all([getResources(), source ? getIdxSource() : null])
    .then(function (r) {
      var res = r[0];
      var allow = null;
      if (source) {
        var set = new Set(r[1][source === "plants" ? "plants" : "bees"] || []);
        allow = set;
      }
      var matched = [];
      var modsCount = {};
      var i, x, q;
      for (i = 0; i < res.length; i++) {
        x = res[i];
        if (kind && x.kind !== kind) continue;
        if (allow && !allow.has(x.kind + ":" + x.id)) continue;
        if (query) {
          var name = mem.resLower[i];
          q = query;
          if (name !== q && name.indexOf(q) === -1 && (x.id || "").toLowerCase().indexOf(q) === -1) continue;
        }
        matched.push(x);
        var m = modOf(x.id);
        modsCount[m] = (modsCount[m] || 0) + 1;
      }
      if (sort === "popular" || !query) {
        matched.sort(function (a, b) {
          return (b.recipeCount || 0) - (a.recipeCount || 0) ||
                 (a.displayName < b.displayName ? -1 : 1);
        });
      } else {
        matched.sort(function (a, b) {
          return a.displayName < b.displayName ? -1 : 1;
        });
      }
      var total = matched.length;
      var page = matched.slice(offset, offset + limit);
      var mods = Object.keys(modsCount).map(function (k) {
        return { id: k, count: modsCount[k] };
      }).sort(function (a, b) { return b.count - a.count; });
      return jsonResponse({
        resources: page,
        total: total,
        offset: offset,
        limit: limit,
        hasMore: offset + limit < total,
        mods: mods,
        searchPhase: "exact",
        corrections: [],
      });
    });
}

/* ---------- /recipes 列表模拟 ---------- */
var TIER_DICT = null;

function tierRank(code) { return code; } // summaries.tier 已按 TIER_ORDER 编码

function parseClause(clause) {
  // makes:item:xxx / takes:item:xxx / uses:item:xxx
  if (!clause) return null;
  var parts = clause.split(":");
  return { op: parts[0], kind: parts[1], id: parts.slice(2).join(":") };
}

function handleRecipes(params) {
  var query = (params.get("query") || "").trim().toLowerCase();
  var offset = parseInt(params.get("offset") || "0", 10) || 0;
  var limit = parseInt(params.get("limit") || "120", 10) || 120;
  var maxTier = params.get("maxTier") || "all";
  var clause = parseClause(params.get("clause"));
  var resourceKind = params.get("resourceKind");
  var resourceId = params.get("resourceId");

  return getSummaries().then(function (s) {
    TIER_DICT = s.tierDict;
    var maxRank = maxTier === "all" ? -1 : TIER_DICT.indexOf(maxTier);

    var baseSet = null;
    var key = null;
    if (clause) key = clause.kind + ":" + clause.id;
    else if (resourceId) key = (resourceKind || "item") + ":" + resourceId;

    var work;
    if (key) {
      var idxName = clause && clause.op === "takes" ? "takes" : "makes";
      work = getIdx(idxName).then(function (idx) {
        var arr = idx[key] || [];
        // uses / makes 缺省时合并两者
        if (!clause || clause.op !== "takes") {
          return getIdx("takes").then(function (t) {
            var other = t[key] || [];
            if (!arr.length) return other;
            if (!other.length) return arr;
            var set = new Set(arr);
            for (var i = 0; i < other.length; i++) set.add(other[i]);
            return Array.from(set);
          });
        }
        return arr;
      });
    } else {
      var all = new Array(s.ids.length);
      for (var i = 0; i < all.length; i++) all[i] = i;
      work = Promise.resolve(all);
    }

    return work.then(function (candidates) {
      var rmDict = s.recipeMapDict, mtDict = s.machineTypeDict;
      var filtered = [];
      var counts = {};
      var mapsPresent = {};
      var i, code;
      for (i = 0; i < candidates.length; i++) {
        var idx = candidates[i];
        var t = s.tier[idx];
        if (maxRank >= 0) {
          if (t === 0) continue; // NONE 仅在 all 时出现
          if (t > maxRank) continue;
        }
        if (query) {
          var nm = (s.names[idx] || "").toLowerCase();
          var mt = mtDict[s.machineType[idx]].toLowerCase();
          var rm = rmDict[s.recipeMap[idx]].toLowerCase();
          if (nm.indexOf(query) === -1 && mt.indexOf(query) === -1 && rm.indexOf(query) === -1) continue;
        }
        filtered.push(idx);
        code = rmDict[s.recipeMap[idx]];
        counts[code] = (counts[code] || 0) + 1;
        mapsPresent[code] = true;
      }
      filtered.sort(function (a, b) {
        var ra = rmDict[s.recipeMap[a]], rb = rmDict[s.recipeMap[b]];
        if (ra !== rb) return ra < rb ? -1 : 1;
        var ma = mtDict[s.machineType[a]], mb = mtDict[s.machineType[b]];
        if (ma !== mb) return ma < mb ? -1 : 1;
        if (s.tier[a] !== s.tier[b]) return s.tier[a] - s.tier[b];
        if (s.durationTicks[a] !== s.durationTicks[b]) return s.durationTicks[a] - s.durationTicks[b];
        var na = s.names[a], nb = s.names[b];
        return na < nb ? -1 : na > nb ? 1 : 0;
      });

      var total = filtered.length;
      var pageIdx = filtered.slice(offset, offset + limit);

      // 加载所需 shards
      var need = {};
      for (i = 0; i < pageIdx.length; i++) need[s.shardIndex[pageIdx[i]]] = true;
      var shardIds = Object.keys(need);
      return Promise.all(shardIds.map(getShard)).then(function () {
        var recipes = [];
        for (i = 0; i < pageIdx.length; i++) {
          var ri = pageIdx[i];
          var list = mem.shards.get(s.shardIndex[ri]);
          var id = s.ids[ri];
          var full = null;
          for (var j = 0; j < list.length; j++) {
            if (list[j].id === id) { full = list[j]; break; }
          }
          if (!full) continue;
          var out = {};
          for (var k in full) out[k] = full[k];
          out.recipeMap = rmDict[s.recipeMap[ri]];
          out.slots = [];
          recipes.push(out);
        }
        var recipeMaps = Object.keys(mapsPresent).sort();
        var recipeMapIcons = {};
        return getCatalog().then(function (cat) {
          var icons = (cat && cat.recipeMapIcons) || {};
          var iconByMap = {};
          for (var i2 = 0; i2 < icons.length; i2++) {
            iconByMap[icons[i2].recipeMap] = icons[i2].resource;
          }
          for (var m2 = 0; m2 < recipeMaps.length; m2++) {
            if (iconByMap[recipeMaps[m2]]) recipeMapIcons[recipeMaps[m2]] = iconByMap[recipeMaps[m2]];
          }
          return jsonResponse({
            recipes: recipes,
            total: total,
            recipeMaps: recipeMaps,
            recipeMapCounts: counts,
            recipeMapIcons: recipeMapIcons,
            offset: offset,
            limit: limit,
            hasMore: offset + limit < total,
            searchPhase: "exact",
            corrections: [],
          });
        });
      });
    });
  });
}

/* ---------- resolve-recipes ---------- */
function handleResolve(body) {
  var stubs = (body && body.recipes) || [];
  return getSummaries().then(function (s) {
    var matches = [];
    var jobs = [];
    stubs.forEach(function (stub, i) {
      if (stub.id && mem.idToIdx.has(stub.id)) {
        matches.push({ importedId: stub.id, recipeId: stub.id });
        return;
      }
      // 按名字+机器类型匹配
      var qname = (stub.name || "").toLowerCase();
      var qmt = (stub.machineType || "").toLowerCase();
      if (!qname) return;
      for (var idx = 0; idx < s.ids.length; idx++) {
        if ((s.names[idx] || "").toLowerCase() === qname &&
            (!qmt || (s.machineTypeDict[s.machineType[idx]] || "").toLowerCase() === qmt)) {
          (function (importedId, recipeId) {
            jobs.push(getRecipeById(recipeId).then(function (r) {
              if (r) matches.push({ importedId: importedId, recipeId: recipeId });
            }));
          })(stub.id, s.ids[idx]);
          break;
        }
      }
    });
    return Promise.all(jobs).then(function () { return jsonResponse({ matches: matches }); });
  });
}

/* ---------- 请求分发 ---------- */
function handleApi(pathname, req) {
  var m = pathname.match(/^\/gtnh-planner-zh\/api\/datasets\/[^/]+\/(.*)$/);
  var sub = m ? m[1] : "";

  if (sub === "catalog") {
    return getCatalog().then(jsonResponse);
  }
  if (sub === "resources") {
    return handleResources(new URL(req.url).searchParams);
  }
  if (sub === "recipes") {
    return handleRecipes(new URL(req.url).searchParams);
  }
  if (sub.indexOf("recipes/") === 0) {
    var id = decodeURIComponent(sub.slice("recipes/".length));
    return getRecipeById(id).then(function (r) {
      if (r) return jsonResponse(r);
      return jsonResponse({ error: "not found" }, 404);
    });
  }
  if (sub === "recipe-ids") {
    if (mem.recipeIds) return Promise.resolve(jsonResponse({ recipeIds: mem.recipeIds }));
    return loadGzJson(DATA + "recipe_ids.json.gz").then(function (d) {
      mem.recipeIds = d;
      return jsonResponse({ recipeIds: d });
    });
  }
  if (sub === "resolve-recipes") {
    return req.json().then(handleResolve);
  }
  if (sub === "crops") {
    if (mem.crops) return Promise.resolve(jsonResponse(mem.crops));
    return loadGzJson(DATA + "crops.json.gz").then(function (d) { mem.crops = d; return jsonResponse(d); });
  }
  if (sub === "mobs") {
    if (mem.mobs) return Promise.resolve(jsonResponse(mem.mobs));
    return loadGzJson(DATA + "mobs.json.gz").then(function (d) { mem.mobs = d; return jsonResponse(d); });
  }
  return Promise.resolve(jsonResponse({ error: "unknown endpoint" }, 404));
}

/* ---------- SW 生命周期 ---------- */
self.addEventListener("install", function (e) {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_SHELL) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  var p = url.pathname;

  // API 模拟
  if (p.indexOf(BASE + "/api/datasets/") === 0) {
    event.respondWith(
      handleApi(p, event.request).catch(function (e) {
        return jsonResponse({ error: "sw handler exception", msg: String(e && e.stack || e) }, 500);
      })
    );
    return;
  }
  if (p === BASE + "/api/version") {
    event.respondWith(Promise.resolve(jsonResponse({ version: "3.9.2" })));
    return;
  }
  if (p.indexOf(BASE + "/api/") === 0) {
    // community / blueprints / library: 空桩
    event.respondWith(Promise.resolve(jsonResponse({ items: [], plans: [], total: 0, hasMore: false }, 200)));
    return;
  }

  // manifest 等本地 JSON 直接走网络/缓存, 不代理
  if (p === BASE + "/datasets/gtnh/datasets.manifest.json") {
    event.respondWith(
      fetch(event.request).catch(function () {
        return caches.match(event.request);
      })
    );
    return;
  }

  // 纹理直链线上源站, 不经 SW
  // app shell: 缓存优先
  if (p.indexOf(BASE + "/_next/") === 0 || p === BASE + "/" || p === BASE + "/index.html") {
    event.respondWith(
      caches.open(CACHE_SHELL).then(function (cache) {
        return cache.match(event.request).then(function (hit) {
          if (hit) return hit;
          return fetch(event.request).then(function (resp) {
            if (resp.ok) cache.put(event.request, resp.clone());
            return resp;
          }).catch(function () {
            if (p === BASE + "/" || p === BASE + "/index.html") {
              return cache.match(BASE + "/index.html");
            }
            return Response.error();
          });
        });
      })
    );
    return;
  }
});
