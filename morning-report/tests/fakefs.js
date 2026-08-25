/* An in-memory stand-in for the File System Access API + IndexedDB,
   backed by sessionStorage so it survives a reload the way a real
   FileSystemDirectoryHandle does. Test scaffolding only.

   This is the shared preamble every suite installs, so it also carries
   the front-door code — otherwise each suite would open onto the gate
   instead of the page it means to test. gate.test.js clears it first
   and drives the gate properly. */
(function(){
  try { localStorage.setItem("sage-mr-gate", "2026"); } catch (e) { /* private mode */ }
  /* The site ships with a real public endpoint baked in. Tests must
     never touch the real network, so the preamble switches it off;
     the suite that tests the public path turns it back on against
     its own stub. */
  window.MR_PUBLIC_ENDPOINT = "";
})();

(function(){
  var KEY = "__fakefs__", IDBKEY = "__fakeidb__";

  function loadTree(){
    try { return JSON.parse(localStorage.getItem(KEY)) || { f:{}, d:{} }; }
    catch(e){ return { f:{}, d:{} }; }
  }
  function saveTree(t){ localStorage.setItem(KEY, JSON.stringify(t)); }
  if (!localStorage.getItem(KEY)) saveTree({ f:{}, d:{} });

  function NotFound(){ var e=new Error("not found"); e.name="NotFoundError"; return e; }

  /* path is an array of directory names from the root */
  function nodeAt(tree, path, create){
    var n = tree;
    for (var i=0;i<path.length;i++){
      if (!n.d[path[i]]){ if(!create) return null; n.d[path[i]] = { f:{}, d:{} }; }
      n = n.d[path[i]];
    }
    return n;
  }

  function makeDir(name, path){
    return {
      kind:"directory", name:name, __path:path,
      queryPermission:function(){ return Promise.resolve("granted"); },
      requestPermission:function(){ return Promise.resolve("granted"); },
      getDirectoryHandle:function(n,o){
        var t=loadTree();
        if (!nodeAt(t, path.concat(n), false)){
          if(!(o&&o.create)) return Promise.reject(NotFound());
          nodeAt(t, path.concat(n), true); saveTree(t);
        }
        return Promise.resolve(makeDir(n, path.concat(n)));
      },
      getFileHandle:function(n,o){
        var t=loadTree(), dir=nodeAt(t, path, false);
        if (!dir || !(n in dir.f)){
          if(!(o&&o.create)) return Promise.reject(NotFound());
          dir = nodeAt(t, path, true); dir.f[n]=""; saveTree(t);
        }
        return Promise.resolve({
          kind:"file", name:n,
          getFile:function(){
            var d=nodeAt(loadTree(), path, false);
            return Promise.resolve({ text:function(){ return Promise.resolve(d ? d.f[n] : ""); } });
          },
          createWritable:function(){
            var buf="";
            return Promise.resolve({
              write:function(x){ buf+=x; return Promise.resolve(); },
              close:function(){ var t2=loadTree(); nodeAt(t2,path,true).f[n]=buf; saveTree(t2); return Promise.resolve(); }
            });
          }
        });
      },
      removeEntry:function(n){
        var t=loadTree(), dir=nodeAt(t, path, false);
        if (!dir) return Promise.reject(NotFound());
        if (n in dir.f){ delete dir.f[n]; saveTree(t); return Promise.resolve(); }
        if (n in dir.d){ delete dir.d[n]; saveTree(t); return Promise.resolve(); }
        return Promise.reject(NotFound());
      },
      values:function(){
        var dir=nodeAt(loadTree(), path, false) || { f:{}, d:{} };
        var items=Object.keys(dir.f).map(function(k){return {kind:"file",name:k};})
          .concat(Object.keys(dir.d).map(function(k){return {kind:"directory",name:k};}));
        var i=0;
        return { next:function(){ return Promise.resolve(i<items.length?{done:false,value:items[i++]}:{done:true}); } };
      }
    };
  }

  window.showDirectoryPicker = function(){ return Promise.resolve(makeDir("MorningReport", [])); };

  /* Fake IndexedDB that stores the handle by rebuilding it from a token,
     so store.js's restore() path runs for real across a reload. */
  var fakeIDB = {
    open: function(){
      var req = {};
      setTimeout(function(){
        req.result = {
          transaction: function(){
            return {
              objectStore: function(){
                return {
                  put: function(val, key){ sessionStorage.setItem(IDBKEY, JSON.stringify({ key:key, name:val.name, path:val.__path })); },
                  get: function(){
                    var r = {};
                    setTimeout(function(){
                      var raw = sessionStorage.getItem(IDBKEY);
                      r.result = raw ? makeDir(JSON.parse(raw).name, JSON.parse(raw).path) : undefined;
                      r.onsuccess && r.onsuccess();
                    }, 0);
                    return r;
                  },
                  delete: function(){ sessionStorage.removeItem(IDBKEY); }
                };
              },
              set oncomplete(fn){ setTimeout(fn, 0); },
              set onerror(fn){ /* never errors */ }
            };
          }
        };
        req.onsuccess && req.onsuccess();
      }, 0);
      return req;
    }
  };
  Object.defineProperty(window, 'indexedDB', { value: fakeIDB, configurable: true, writable: true });
})();
