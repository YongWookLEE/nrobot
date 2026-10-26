// 작은 XML 파서. Python ElementTree와 같은 의미로 쓴다:
// - text = 첫 자식 요소 앞의 글자 (없으면 null)
// - 줄바꿈 정규화(\r\n → \n), 속성 값 공백 정규화
// 이름공간은 접두어를 떼고 로컬 이름으로 비교한다(xlsx 부품 안에서는 충돌하지 않음).

export interface XmlElement {
  /** 로컬 이름 (접두어 제외) */
  name: string;
  /** 접두어 포함 이름 */
  qname: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (m, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return ENTITIES[ref] ?? m;
  });
}

const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, "\n");
const localName = (q: string) => {
  const i = q.indexOf(":");
  return i < 0 ? q : q.slice(i + 1);
};

export function bufferToXmlString(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  const s = buf.toString("utf8");
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function parseXml(input: string | Buffer): XmlElement {
  const src = typeof input === "string" ? input : bufferToXmlString(input);
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let i = 0;
  const n = src.length;

  const addText = (t: string) => {
    const cur = stack[stack.length - 1];
    if (!cur || t === "") return;
    // ElementTree: 첫 자식 앞 글자만 text. 자식 뒤 글자(tail)는 쓰지 않는다.
    if (cur.children.length === 0) cur.text = (cur.text ?? "") + t;
  };

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      addText(decode(normalizeNewlines(src.slice(i))));
      break;
    }
    if (lt > i) addText(decode(normalizeNewlines(src.slice(i, lt))));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end < 0) throw new Error("XML 주석이 닫히지 않았습니다.");
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      if (end < 0) throw new Error("XML CDATA가 닫히지 않았습니다.");
      addText(normalizeNewlines(src.slice(lt + 9, end)));
      i = end + 3;
    } else if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      if (end < 0) throw new Error("XML 선언이 닫히지 않았습니다.");
      i = end + 2;
    } else if (src.startsWith("<!", lt)) {
      // DOCTYPE 등: 내부 부분집합 [...] 고려
      let j = lt + 2;
      let depth = 0;
      while (j < n) {
        const ch = src[j];
        if (ch === "[") depth++;
        else if (ch === "]") depth--;
        else if (ch === ">" && depth <= 0) break;
        j++;
      }
      i = j + 1;
    } else if (src[lt + 1] === "/") {
      const end = src.indexOf(">", lt);
      if (end < 0) throw new Error("XML 태그가 닫히지 않았습니다.");
      const qname = src.slice(lt + 2, end).trim();
      const cur = stack.pop();
      if (!cur || cur.qname !== qname) throw new Error(`XML 태그 짝이 맞지 않습니다: ${qname}`);
      i = end + 1;
    } else {
      // 시작 태그
      let j = lt + 1;
      while (j < n && !/[\s/>]/.test(src[j])) j++;
      const qname = src.slice(lt + 1, j);
      const attrs: Record<string, string> = {};
      let selfClose = false;
      for (;;) {
        while (j < n && /\s/.test(src[j])) j++;
        if (j >= n) throw new Error("XML 태그가 닫히지 않았습니다.");
        if (src[j] === ">") { j++; break; }
        if (src[j] === "/" && src[j + 1] === ">") { selfClose = true; j += 2; break; }
        const eq = src.indexOf("=", j);
        if (eq < 0) throw new Error("XML 속성 형식이 잘못되었습니다.");
        const an = src.slice(j, eq).trim();
        let q = eq + 1;
        while (q < n && /\s/.test(src[q])) q++;
        const quote = src[q];
        if (quote !== '"' && quote !== "'") throw new Error("XML 속성 형식이 잘못되었습니다.");
        const close = src.indexOf(quote, q + 1);
        if (close < 0) throw new Error("XML 속성 형식이 잘못되었습니다.");
        attrs[an] = decode(src.slice(q + 1, close).replace(/[\t\n\r]/g, " "));
        j = close + 1;
      }
      const el: XmlElement = { name: localName(qname), qname, attrs, children: [], text: null };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(el);
      else if (!root) root = el;
      if (!selfClose) stack.push(el);
      i = j;
    }
  }
  if (!root) throw new Error("XML 내용이 없습니다.");
  return root;
}

/** 이름이 local인 첫 자식 */
export function child(el: XmlElement | null | undefined, local: string): XmlElement | null {
  if (!el) return null;
  for (const c of el.children) if (c.name === local) return c;
  return null;
}

export function childrenNamed(el: XmlElement | null | undefined, local: string): XmlElement[] {
  return el ? el.children.filter((c) => c.name === local) : [];
}

/** 경로(자식 이름들)를 따라가며 모두 찾는다. ElementTree findall('a/b/c') */
export function findAll(el: XmlElement, path: string[]): XmlElement[] {
  let cur = [el];
  for (const p of path) cur = cur.flatMap((c) => childrenNamed(c, p));
  return cur;
}

/** 문서 순서대로 모든 자손 중 이름이 local인 것. ElementTree findall('.//x') */
export function descendants(el: XmlElement, local: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (e: XmlElement) => {
    for (const c of e.children) {
      if (c.name === local) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

/** 첫 자손. ElementTree find('.//x') */
export function firstDescendant(el: XmlElement, local: string): XmlElement | null {
  for (const c of el.children) {
    if (c.name === local) return c;
    const d = firstDescendant(c, local);
    if (d) return d;
  }
  return null;
}

/** 접두어가 붙은 속성(예: r:id, r:embed)을 로컬 이름으로 찾는다. */
export function prefixedAttr(el: XmlElement, local: string): string | undefined {
  for (const [k, v] of Object.entries(el.attrs)) {
    const i = k.indexOf(":");
    if (i > 0 && k.slice(i + 1) === local && k.slice(0, i) !== "xmlns") return v;
  }
  return undefined;
}

/** 자손 t 요소들의 글자를 잇는다 (공유 문자열·인라인 문자열) */
export function joinT(el: XmlElement): string {
  return descendants(el, "t").map((t) => t.text ?? "").join("");
}
