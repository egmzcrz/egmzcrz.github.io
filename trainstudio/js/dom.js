// =============================================================
// DOM — Element cache + creation helpers
// =============================================================
const DOM = (function() {
  'use strict';

  const _cache = {};

  /** Get a cached element reference by id. */
  function get(id) {
    if (!_cache[id]) {
      _cache[id] = document.getElementById(id);
    }
    return _cache[id];
  }

  /** Invalidate a cached reference (e.g. after innerHTML replacement). */
  function clearCache(id) {
    delete _cache[id];
  }

  /** Create an element with attributes, event listeners, and children. */
  function el(tag, attrs, ...children) {
    const elem = document.createElement(tag);

    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null) continue;

        if (key === 'className') {
          elem.className = value;
        } else if (key === 'htmlFor') {
          elem.setAttribute('for', value);
        } else if (key === 'innerHTML') {
          elem.innerHTML = value;
        } else if (key.startsWith('on')) {
          // onClick, onChange, etc.
          elem.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'style' && typeof value === 'object') {
          Object.assign(elem.style, value);
        } else if (key === 'dataset' && typeof value === 'object') {
          Object.assign(elem.dataset, value);
        } else if (key === 'type') {
          elem.type = value;
        } else if (key === 'value') {
          elem.value = value;
        } else if (key === 'title') {
          elem.title = value;
        } else if (key === 'tabIndex') {
          elem.tabIndex = value;
        } else {
          elem.setAttribute(key, value);
        }
      }
    }

    for (const child of children) {
      if (child == null) continue;
      if (typeof child === 'string' || typeof child === 'number') {
        elem.appendChild(document.createTextNode(String(child)));
      } else if (Array.isArray(child)) {
        child.forEach(c => { if (c != null) elem.appendChild(c); });
      } else {
        elem.appendChild(child);
      }
    }

    return elem;
  }

  /** Create a text node. */
  function text(content) {
    return document.createTextNode(String(content));
  }

  /** Create an icon element (Font Awesome). */
  function icon(name) {
    return el('i', { className: 'fa-solid ' + name });
  }

  return { get, clearCache, el, text, icon };
})();
