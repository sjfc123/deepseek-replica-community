/*
 * 启动引导层：先补齐旧 WebView 缺失的语言能力，再挂启动状态。
 * 这一层必须是 ES5，且比主包先执行；主包用到的新 API 在这里补，避免旧内核直接抛错白屏。
 */
(function () {
  'use strict';

  /* ===== 一、语言能力补齐（按缺失项逐个补齐，不覆盖原生实现） ===== */

  var missing = [];

  function define(target, key, value) {
    if (!target || typeof target[key] === 'function') {
      return;
    }
    missing.push(key);
    try {
      Object.defineProperty(target, key, {
        value: value,
        writable: true,
        configurable: true,
        enumerable: false
      });
    } catch (e) {
      target[key] = value;
    }
  }

  /* 相对索引：负数从尾部数 */
  function relativeIndex(length, index) {
    var n = parseInt(index, 10);
    if (isNaN(n)) {
      n = 0;
    }
    return n < 0 ? length + n : n;
  }

  define(Object, 'hasOwn', function (object, key) {
    return Object.prototype.hasOwnProperty.call(Object(object), key);
  });

  define(Array.prototype, 'at', function (index) {
    var i = relativeIndex(this.length, index);
    return i >= 0 && i < this.length ? this[i] : undefined;
  });

  define(String.prototype, 'at', function (index) {
    var i = relativeIndex(this.length, index);
    return i >= 0 && i < this.length ? this.charAt(i) : undefined;
  });

  define(String.prototype, 'replaceAll', function (search, replacement) {
    var source = String(this);
    if (typeof search === 'string') {
      if (search === '') {
        /* 与原生一致：空串在每个字符间隙插入替换值 */
        var fill = String(replacement);
        var out = fill;
        for (var i = 0; i < source.length; i++) {
          out += source.charAt(i) + fill;
        }
        return out;
      }
      return source.split(search).join(String(replacement));
    }
    if (search && search.global) {
      return source.replace(search, replacement);
    }
    throw new TypeError('replaceAll 需要字符串或带 global 标记的正则');
  });

  define(Array.prototype, 'flat', function (depth) {
    var limit = depth === undefined ? 1 : Number(depth) || 0;
    var out = [];
    function walk(list, level) {
      for (var i = 0; i < list.length; i++) {
        if (!(i in list)) {
          continue;
        }
        var item = list[i];
        if (Array.isArray(item) && level < limit) {
          walk(item, level + 1);
        } else {
          out.push(item);
        }
      }
    }
    walk(this, 0);
    return out;
  });

  define(Array.prototype, 'flatMap', function (mapper, thisArg) {
    var out = [];
    for (var i = 0; i < this.length; i++) {
      if (!(i in this)) {
        continue;
      }
      var mapped = mapper.call(thisArg, this[i], i, this);
      if (Array.isArray(mapped)) {
        for (var j = 0; j < mapped.length; j++) {
          out.push(mapped[j]);
        }
      } else {
        out.push(mapped);
      }
    }
    return out;
  });

  define(Array.prototype, 'findLast', function (predicate, thisArg) {
    for (var i = this.length - 1; i >= 0; i--) {
      if (predicate.call(thisArg, this[i], i, this)) {
        return this[i];
      }
    }
    return undefined;
  });

  define(Array.prototype, 'findLastIndex', function (predicate, thisArg) {
    for (var i = this.length - 1; i >= 0; i--) {
      if (predicate.call(thisArg, this[i], i, this)) {
        return i;
      }
    }
    return -1;
  });

  define(Object, 'fromEntries', function (entries) {
    var out = {};
    var list = Array.isArray(entries) ? entries : Array.prototype.slice.call(entries || []);
    for (var i = 0; i < list.length; i++) {
      if (list[i]) {
        out[list[i][0]] = list[i][1];
      }
    }
    return out;
  });

  if (typeof Promise !== 'undefined') {
    define(Promise, 'allSettled', function (list) {
      var items = Array.prototype.slice.call(list || []);
      return Promise.all(
        items.map(function (item) {
          return Promise.resolve(item).then(
            function (value) {
              return { status: 'fulfilled', value: value };
            },
            function (reason) {
              return { status: 'rejected', reason: reason };
            }
          );
        })
      );
    });
  }

  /* 结构化克隆：本机数据仅含纯 JSON 结构、Date、Map、Set 与 Blob */
  define(window, 'structuredClone', function (value) {
    if (value === undefined || value === null || typeof value !== 'object') {
      return value;
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      return value.slice(0, value.size, value.type);
    }
    if (value instanceof Date) {
      return new Date(value.getTime());
    }
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return window.structuredClone(item);
      });
    }
    if (typeof Map !== 'undefined' && value instanceof Map) {
      var map = new Map();
      value.forEach(function (item, key) {
        map.set(window.structuredClone(key), window.structuredClone(item));
      });
      return map;
    }
    if (typeof Set !== 'undefined' && value instanceof Set) {
      var set = new Set();
      value.forEach(function (item) {
        set.add(window.structuredClone(item));
      });
      return set;
    }
    var out = {};
    for (var key in value) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        out[key] = window.structuredClone(value[key]);
      }
    }
    return out;
  });

  if (typeof window.globalThis === 'undefined') {
    missing.push('globalThis');
    window.globalThis = window;
  }

  /* 空闲回调：缺失时退化为短延时，仍推迟到首屏之后执行 */
  define(window, 'requestIdleCallback', function (callback) {
    return window.setTimeout(function () {
      callback({
        didTimeout: true,
        timeRemaining: function () {
          return 0;
        }
      });
    }, 200);
  });
  define(window, 'cancelIdleCallback', function (id) {
    window.clearTimeout(id);
  });

  /* 随机 id：randomUUID 仅限安全上下文，assets 加载场景通常不可用 */
  if (window.crypto && typeof window.crypto.randomUUID !== 'function') {
    missing.push('randomUUID');
    window.crypto.randomUUID = function () {
      var bytes = new Uint8Array(16);
      if (typeof window.crypto.getRandomValues === 'function') {
        window.crypto.getRandomValues(bytes);
      } else {
        for (var i = 0; i < 16; i++) {
          bytes[i] = Math.floor(Math.random() * 256);
        }
      }
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      var hex = [];
      for (var j = 0; j < 16; j++) {
        hex.push((bytes[j] + 0x100).toString(16).slice(1));
      }
      return (
        hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
        hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' +
        hex.slice(10, 16).join('')
      );
    };
  }

  /* 媒体查询旧签名：仅提供 addListener 的内核补上 addEventListener */
  if (typeof window.matchMedia === 'function') {
    var probe = window.matchMedia('(min-width: 0px)');
    if (probe && typeof probe.addEventListener !== 'function' && typeof probe.addListener === 'function') {
      missing.push('MediaQueryList.addEventListener');
      var nativeMatchMedia = window.matchMedia;
      window.matchMedia = function (query) {
        var list = nativeMatchMedia.call(window, query);
        if (list && typeof list.addEventListener !== 'function') {
          list.addEventListener = function (type, handler) {
            if (type === 'change') {
              list.addListener(handler);
            }
          };
          list.removeEventListener = function (type, handler) {
            if (type === 'change') {
              list.removeListener(handler);
            }
          };
        }
        return list;
      };
    }
  }

  /* Blob 二进制/文本读取：Chrome 76 起提供，旧内核仅有 FileReader */
  if (typeof Blob !== 'undefined') {
    if (typeof Blob.prototype.arrayBuffer !== 'function') {
      Blob.prototype.arrayBuffer = function () {
        var blob = this;
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = function () { reject(reader.error); };
          reader.readAsArrayBuffer(blob);
        });
      };
      missing.push('Blob.arrayBuffer');
    }
    if (typeof Blob.prototype.text !== 'function') {
      Blob.prototype.text = function () {
        var blob = this;
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(String(reader.result)); };
          reader.onerror = function () { reject(reader.error); };
          reader.readAsText(blob);
        });
      };
      missing.push('Blob.text');
    }
  }

  /* 微任务排队：Chrome 71 起提供，缺失时由 Promise 实现 */
  if (typeof window.queueMicrotask !== 'function') {
    window.queueMicrotask = function (task) {
      Promise.resolve().then(function () { task(); }).catch(function (error) {
        setTimeout(function () { throw error; }, 0);
      });
    };
    missing.push('queueMicrotask');
  }

  /* Promise.any：Chrome 85 起提供 */
  if (typeof Promise.any !== 'function') {
    Promise.any = function (list) {
      var items = Array.prototype.slice.call(list || []);
      return new Promise(function (resolve, reject) {
        if (!items.length) {
          reject(new Error('All promises were rejected'));
          return;
        }
        var errors = [];
        var left = items.length;
        items.forEach(function (item, index) {
          Promise.resolve(item).then(resolve, function (reason) {
            errors[index] = reason;
            left -= 1;
            if (left === 0) {
              reject(new Error('All promises were rejected'));
            }
          });
        });
      });
    };
    missing.push('Promise.any');
  }

  window.__replicaCompat = { patched: missing };

  /* ===== 二、启动状态与失败提示（只在首屏阶段生效） ===== */

  var splash = document.getElementById('boot-splash');
  var title = document.getElementById('boot-title');
  var detail = document.getElementById('boot-detail');
  var timer = 0;
  var failed = false;
  var ready = false;

  function fail(message, extra) {
    if (failed || ready) {
      return;
    }
    failed = true;
    window.clearTimeout(timer);
    if (!splash) {
      splash = document.createElement('div');
      splash.id = 'boot-splash';
      document.body.appendChild(splash);
      splash.innerHTML = '<div><div id="boot-title"></div><div id="boot-detail"></div></div>';
      title = document.getElementById('boot-title');
      detail = document.getElementById('boot-detail');
    }
    splash.setAttribute('data-failed', 'true');
    if (title) {
      title.textContent = '没能打开';
    }
    if (detail) {
      detail.textContent =
        (message || '界面脚本没有跑起来') +
        (extra ? '（' + extra + '）' : '') +
        '。先试覆盖安装同一版本；仍打不开就在系统设置里清除本应用数据，这一步会删掉本机对话。';
    }
    try {
      localStorage.setItem(
        'replica:last-boot-error',
        JSON.stringify({
          at: Date.now(),
          message: message || '',
          extra: extra || '',
          patched: missing
        })
      );
    } catch (e) {
      /* 写入失败时仅展示，不影响启动 */
    }
  }

  window.__replicaBootDone = function () {
    ready = true;
    window.clearTimeout(timer);
    /* 启动成功后清除上一轮失败记录，诊断仅保留当前状态 */
    try {
      localStorage.removeItem('replica:last-boot-error');
      localStorage.setItem(
        'replica:last-boot-ok',
        JSON.stringify({ at: Date.now(), patched: missing })
      );
    } catch (e) {
      /* 写入失败不影响启动 */
    }
    if (splash && splash.parentNode) {
      splash.parentNode.removeChild(splash);
    }
  };

  window.addEventListener(
    'error',
    function (event) {
      var target = event.target;
      if (target && target.tagName === 'SCRIPT') {
        fail('界面脚本没加载出来', target.src || '');
        return;
      }
      if (event.error && event.error.stack) {
        /* 保留初始化堆栈，便于定位模块循环引用 */
        // oxlint-disable-next-line no-console -- 启动崩溃诊断只在控制台输出
        console.error(String(event.error.stack));
      }
      fail(event.message || '界面脚本执行出错');
    },
    true
  );

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    fail(
      reason && reason.message ? reason.message : '启动任务失败',
      reason && reason.stack ? String(reason.stack).split('\n')[0] : ''
    );
  });

  timer = window.setTimeout(function () {
    if (!window.__replicaReady) {
      fail('等了太久，主界面还没画出来');
    }
  }, 8000);
})();