/**
 * Minimal frontmatter parser for Prompter templates.
 * Supports: strings, numbers, booleans, inline arrays, nested list of maps.
 */

export function parseFrontmatter(raw) {
  const text = String(raw).replace(/^\uFEFF/, "");
  if (!text.startsWith("---")) {
    return { data: {}, body: text.trim() };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, body: text.trim() };
  }
  const fm = text.slice(3, end).replace(/^\n/, "");
  const body = text.slice(end + 4).replace(/^\n/, "").trim();
  return { data: parseYamlLite(fm), body };
}

function parseYamlLite(src) {
  const lines = src.split("\n");
  const root = {};
  const stack = [{ indent: -1, obj: root, key: null, isArray: false }];

  function current() {
    return stack[stack.length - 1];
  }

  function setValue(key, value, indent) {
    while (stack.length > 1 && indent <= current().indent) stack.pop();
    const cur = current();
    if (cur.isArray) {
      // Should not set key on pure array parent
      cur.obj.push({ [key]: value });
    } else {
      cur.obj[key] = value;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.match(/^ */)[0].length;
    const trimmed = line.trim();

    // Array item
    if (trimmed.startsWith("- ")) {
      while (stack.length > 1 && indent < current().indent) stack.pop();
      const content = trimmed.slice(2).trim();
      const cur = current();

      // Ensure parent field is an array
      let arr;
      if (cur.key && !Array.isArray(cur.obj[cur.key])) {
        cur.obj[cur.key] = [];
      }
      if (cur.key && Array.isArray(cur.obj[cur.key])) {
        arr = cur.obj[cur.key];
      } else if (cur.isArray) {
        arr = cur.obj;
      } else {
        continue;
      }

      if (content.includes(":") && !content.startsWith("'") && !content.startsWith('"')) {
        const { key, value, hasValue } = splitKv(content);
        if (hasValue) {
          arr.push({ [key]: coerce(value) });
        } else {
          const obj = {};
          arr.push(obj);
          stack.push({ indent, obj, key: null, isArray: false });
          // next lines may fill this object; also set first key if bare
          if (key) {
            // wait for nested - actually bare key: means nested block
            stack[stack.length - 1].pendingKey = key;
          }
        }
      } else if (content.includes(":")) {
        const { key, value, hasValue } = splitKv(content);
        const obj = {};
        if (hasValue) obj[key] = coerce(value);
        else {
          arr.push(obj);
          stack.push({ indent, obj, key: null, isArray: false, pendingKey: key });
          continue;
        }
        arr.push(obj);
        stack.push({ indent, obj, key: null, isArray: false });
      } else {
        arr.push(coerce(content));
      }
      continue;
    }

    // key: value
    if (trimmed.includes(":")) {
      while (stack.length > 1 && indent <= current().indent && !current().pendingKey) {
        // pop if less indent
        if (indent <= current().indent) stack.pop();
        else break;
      }
      // fix stack for same-level keys
      while (stack.length > 1 && indent < current().indent) stack.pop();
      if (stack.length > 1 && indent === current().indent && current().obj !== root && !Array.isArray(current().obj)) {
        // sibling of object in array — need parent array context
      }

      const { key, value, hasValue } = splitKv(trimmed);
      const cur = current();

      if (cur.pendingKey && indent > cur.indent) {
        // shouldn't happen often
      }

      if (!hasValue) {
        // nested object or array follows
        const next = peekNextMeaningful(lines, i + 1);
        if (next && next.trim().startsWith("- ")) {
          cur.obj[key] = [];
          stack.push({ indent, obj: cur.obj, key, isArray: false });
        } else {
          const obj = {};
          cur.obj[key] = obj;
          stack.push({ indent, obj, key: null, isArray: false });
        }
      } else {
        // If we're inside an array item object that was just created with only indent
        if (cur.pendingKey) {
          delete cur.pendingKey;
        }
        cur.obj[key] = coerce(value);
        // track last key for following arrays at deeper indent
        cur.key = key;
        cur.indent = Math.min(cur.indent, indent);
        if (cur.indent < 0) cur.indent = indent;
      }
    }
  }

  return root;
}

function peekNextMeaningful(lines, from) {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim() && !lines[i].trim().startsWith("#")) return lines[i];
  }
  return null;
}

function splitKv(s) {
  const idx = s.indexOf(":");
  const key = s.slice(0, idx).trim();
  const value = s.slice(idx + 1).trim();
  return { key, value, hasValue: value.length > 0 };
}

function coerce(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((x) => coerce(x.trim()));
  }
  return v;
}

/**
 * Simpler reliable parser for our template format using a line-state machine
 * tuned for Prompter YAML subset.
 */
export function parseTemplateFile(raw) {
  const text = String(raw).replace(/^\uFEFF/, "");
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return { meta: {}, body: text.trim() };
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = parseSimpleYaml(m[1]);
  const body = m[2].trim();
  return { meta, body };
}

function parseSimpleYaml(src) {
  const result = {};
  const lines = src.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const indent = line.match(/^ */)[0].length;
    if (indent > 0) {
      i++;
      continue;
    }
    const { key, value, hasValue } = splitKv(line.trim());
    if (!hasValue) {
      // look ahead
      const next = lines[i + 1];
      if (next && next.trim().startsWith("- ")) {
        const arr = [];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (!l.trim()) {
            i++;
            continue;
          }
          if (!l.startsWith("  ") && !l.startsWith("\t") && !l.trim().startsWith("- ")) break;
          if (l.trim().startsWith("- ")) {
            const item = l.trim().slice(2).trim();
            if (item.includes(":") && !item.startsWith("[")) {
              // object start
              const obj = {};
              const first = splitKv(item);
              if (first.hasValue) obj[first.key] = coerce(first.value);
              else obj[first.key] = null;
              i++;
              while (i < lines.length) {
                const nl = lines[i];
                if (!nl.startsWith("    ") && !(nl.startsWith("  ") && !nl.trim().startsWith("- "))) {
                  // still allow 2-space keys under list item
                  if (nl.match(/^  \w/) && nl.includes(":") && !nl.trim().startsWith("- ")) {
                    const kv = splitKv(nl.trim());
                    obj[kv.key] = kv.hasValue ? coerce(kv.value) : true;
                    i++;
                    continue;
                  }
                  break;
                }
                if (nl.trim().startsWith("- ")) break;
                if (nl.includes(":")) {
                  const kv = splitKv(nl.trim());
                  obj[kv.key] = kv.hasValue ? coerce(kv.value) : true;
                }
                i++;
              }
              // clean nulls from bare keys that got values later
              arr.push(obj);
              continue;
            } else {
              arr.push(coerce(item));
              i++;
              continue;
            }
          }
          break;
        }
        result[key] = arr;
        continue;
      }
      result[key] = {};
      i++;
      continue;
    }
    result[key] = coerce(value);
    i++;
  }
  return result;
}
