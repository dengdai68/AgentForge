// A Store-owned identity map and undo journal. Proxies never cross its boundary.
const originals = new WeakMap();
const ROW_SOURCE = Symbol.for('agentforge.rows');
export function copyState(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  const raw = originals.get(value);
  if (raw) return copyState(raw);
  if (Array.isArray(value)) return value.map(copyState);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyState(item)]));
}
export function createStateJournal(initial) {
  const proxies = new WeakMap(), changes = new Map(), undo = [], indexes = new Map(), identities = new Map(), subscribers = new Set();
  let recording = false, revision = 0;
  const versions = new Map();
  const raw = value => originals.get(value) || value;
  function changed(collection, identity) {
    let set = changes.get(collection);
    if (!set) changes.set(collection, set = new Set());
    set.add(identity);
    initial[collection]?.[ROW_SOURCE]?.pin(identity);
    versions.set(collection, (versions.get(collection) || 0) + 1);
    for (const index of indexes.get(collection)?.values() || []) index.dirty.add(identity);
  }
  function wrap(value, collection, entity, top = false) {
    if (!value || typeof value !== 'object') return value;
    value = raw(value);
    if (proxies.has(value)) return proxies.get(value);
    const proxy = new Proxy(value, {
      get(target, key, receiver) {
        if (key === ROW_SOURCE) return target[key];
        const item = Reflect.get(target, key, receiver);
        if (top) return wrap(item, key, null);
        if (Array.isArray(target) && entity === null && /^\d+$/.test(String(key))) return wrap(item, collection, item?.id ?? null);
        return wrap(item, collection, entity);
      },
      set(target, key, next) {
        next = raw(next);
        if (Object.is(target[key], next)) return true;
        if (recording) {
          const descriptor = Object.getOwnPropertyDescriptor(target, key), length = Array.isArray(target) ? target.length : null;
          const tail = key === 'length' && next < target.length ? target.slice(next) : null;
          undo.push(() => {
            if (descriptor) Object.defineProperty(target, key, descriptor); else delete target[key];
            if (length !== null) target.length = length;
            if (tail) tail.forEach((item, index) => { target[next + index] = item; });
          });
        }
        if (top) changed(key, null);
        else if (Array.isArray(target) && entity === null) {
          if (key === 'length' || Number(key) < target.length) identities.delete(collection);
          // Position changes and removals are reconciled once for this collection.
          changed(collection, key === 'length' ? null : next?.id ?? null);
          if (target[key]?.id) changed(collection, target[key].id);
        } else changed(collection, entity);
        return Reflect.set(target, key, next);
      },
      deleteProperty(target, key) {
        if (!Object.hasOwn(target, key)) return true;
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (recording) undo.push(() => Object.defineProperty(target, key, descriptor));
        changed(top ? key : collection, top ? null : entity);
        identities.delete(top ? key : collection);
        return Reflect.deleteProperty(target, key);
      }
    });
    proxies.set(value, proxy); originals.set(proxy, value);
    return proxy;
  }
  const state = wrap(initial, null, null, true);
  function identity(name) {
    let index = identities.get(name);
    const rows = initial[name] || [];
    if (!index || index.rows !== rows || index.length > rows.length) {
      index = {rows, length: 0, values: new Map()}; identities.set(name, index);
    }
    for (let i = index.length; i < rows.length; i++) {
      const id=rows[ROW_SOURCE] ? rows[ROW_SOURCE].idAt(i) : rows[i]?.id;
      if(id) index.values.set(id,{get value(){return rows[i];},position:i});
    }
    index.length = rows.length;
    return index.values;
  }
  return {
    state, changes,
    revision: () => revision,
    version: name => versions.get(name) || 0,
    begin() { if (recording) throw new Error('Nested state journal'); recording = true; },
    commit() { recording = false; undo.length = 0; if (changes.size) { revision++; for (const fn of subscribers) { try { fn(changes); } catch { /* Derived observers cannot roll back a durable commit. */ } } } changes.clear(); for(const rows of Object.values(initial)) rows?.[ROW_SOURCE]?.release(); },
    onCommit(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    rollback() { for (let i = undo.length - 1; i >= 0; i--) undo[i](); recording = false; undo.length = 0; changes.clear(); indexes.clear(); identities.clear(); for (const key of versions.keys()) versions.set(key, versions.get(key) + 1); },
    entry(name, id) { return identity(name).get(id); },
    select(name, field, value, {last=null, before=null, limit=null, idsOnly=false}={}) {
      let fields = indexes.get(name);
      if (!fields) indexes.set(name, fields = new Map());
      let index = fields.get(field);
      if (!index || index.dirty.has(null)) {
        index = { values: new Map(), keys: new Map(), dirty: new Set() }; fields.set(field,index);
        const source = initial[name]?.[ROW_SOURCE];
        const items = source ? source.field(field).map(row=>({id:row.id,[field]:row.value})) : state[name] || [];
        for (const item of items) {
          const key = item[field];
          if (!index.values.has(key)) index.values.set(key,new Set());
          index.values.get(key).add(item.id); index.keys.set(item.id,key);
        }
        if(source) for(const id of changes.get(name) || []) if(id!==null) index.dirty.add(id);
      }
      for (const id of index.dirty) {
        const old = index.keys.get(id); index.values.get(old)?.delete(id);
        const item = identity(name).get(id)?.value;
        if (item) {
          const key = item[field];
          if (!index.values.has(key)) index.values.set(key,new Set());
          index.values.get(key).add(id); index.keys.set(id,key);
        } else index.keys.delete(id);
      }
      index.dirty.clear();
      const byId = identity(name);
      let entries=[...(index.values.get(value) || [])].map(id=>({id,entry:byId.get(id)})).filter(item=>item.entry).sort((a,b)=>a.entry.position-b.entry.position);
      if(before){const end=entries.findIndex(item=>item.id===before);if(end<0)throw new Error('分页游标无效');entries=entries.slice(0,end);}
      if(last!==null)entries=entries.slice(-last);
      if(limit!==null)entries=entries.slice(0,limit);
      return idsOnly?entries.map(item=>item.id):entries.map(({entry,id})=>wrap(entry.value,name,id));
    },
    get(name, id) { const entry = identity(name).get(id); return entry ? wrap(entry.value, name, id) : undefined; }
  };
}
