function tokenizeArgs(input) {
  const s = String(input || '').trim();
  if (!s) return [];

  const out = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (ch === '\\' && i + 1 < s.length) {
        const next = s[i + 1];
        if (next === quote || next === '\\') {
          current += next;
          i += 1;
          continue;
        }
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) out.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (current) out.push(current);
  return out;
}

module.exports = { tokenizeArgs };

