// Merge two copies of the board data instead of letting one overwrite the other.
// Used by the page (browser copy vs saved file) and by the server (incoming save vs file on disk),
// so a fresh/empty browser can never wipe saved chats. Deletions are remembered in `deleted`.
(function (root) {
  const stamp = m => Math.max(m.ts || 0, m.edited || 0, m.checked || 0, ...(m.marks || []).map(k => k.ts || 0));

  function mergeBoard(a, b) {
    if (!b || !Array.isArray(b.conversations)) return a;
    if (!a || !Array.isArray(a.conversations)) return b;
    const aNewer = (a.updatedAt || 0) >= (b.updatedAt || 0);
    const older = aNewer ? b : a, newer = aNewer ? a : b;
    const deleted = new Set([...(a.deleted || []), ...(b.deleted || [])]);

    const convs = new Map();
    for (const src of [older, newer]) {
      for (const c of src.conversations) {
        if (deleted.has(c.id)) continue;
        if (src === older && !(c.messages || []).length) continue; // empty chat from a stale/fresh copy
        const prev = convs.get(c.id);
        const msgs = new Map((prev ? prev.messages : []).map(m => [m.id, m]));
        for (const m of c.messages || []) {
          const p = msgs.get(m.id);
          if (!p || stamp(m) >= stamp(p)) msgs.set(m.id, m);
        }
        convs.set(c.id, Object.assign({}, prev, c, {
          messages: [...msgs.values()].filter(m => !deleted.has(m.id)).sort((x, y) => x.ts - y.ts),
        }));
      }
    }
    const vocab = new Map();
    for (const src of [older, newer]) for (const v of src.vocab || []) if (!deleted.has(v.id)) vocab.set(v.id, v);

    const out = Object.assign({}, newer, {
      updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
      conversations: [...convs.values()],
      vocab: [...vocab.values()],
      deleted: [...deleted].slice(-5000),
      activeId: a.activeId, speaker: a.speaker || newer.speaker,
    });
    if (!out.conversations.length) out.conversations = newer.conversations.slice(0, 1);
    if (!out.conversations.some(c => c.id === out.activeId)) out.activeId = out.conversations[0] && out.conversations[0].id;
    return out;
  }
  const count = s => (s && s.conversations || []).reduce((n, c) => n + (c.messages || []).length, 0);

  if (typeof module !== 'undefined' && module.exports) module.exports = { mergeBoard, count };
  else Object.assign(root, { mergeBoard, countMessages: count });
})(typeof window !== 'undefined' ? window : globalThis);
