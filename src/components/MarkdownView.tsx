import { Children, isValidElement, memo, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { headingSlug } from "../lib/format";

// ---------- Mermaid (loaded only when a document actually contains a diagram) ----------

type MermaidApi = (typeof import("mermaid"))["default"];
let mermaidReady: Promise<MermaidApi> | null = null;

function loadMermaid() {
  mermaidReady ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      fontFamily: '"Atkinson Hyperlegible Next Variable", ui-sans-serif, sans-serif',
    });
    return mermaid;
  });
  return mermaidReady;
}

function MermaidBlock({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSvg(null);
    setFailed(false);
    loadMermaid()
      .then((mermaid) => mermaid.render(`mmd${id}${Date.now()}`, code))
      .then(({ svg: out }) => alive && setSvg(out))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [code, id]);

  if (failed) {
    return (
      <figure className="mermaid-figure mermaid-failed">
        <figcaption>Diagram Mermaid (tampil sebagai gambar di GitHub dan Notion)</figcaption>
        <pre>{code}</pre>
      </figure>
    );
  }
  if (!svg) return <div className="mermaid-figure mermaid-loading">Menggambar diagram…</div>;
  return <figure className="mermaid-figure" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// ---------- markdown ----------

function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : ""))
    .join("");
}

function scrollToAnchor(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Renders a PRD. In-document links scroll instead of touching the hash router. */
function MarkdownViewInner({ markdown }: { markdown: string }) {
  const components = useMemo<Components>(
    () => ({
      h2: ({ children }) => <h2 id={headingSlug(textOf(children))}>{children}</h2>,
      h3: ({ children }) => <h3 id={headingSlug(textOf(children))}>{children}</h3>,
      a: ({ href, children }) =>
        href?.startsWith("#") ? (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              scrollToAnchor(decodeURIComponent(href.slice(1)));
            }}
          >
            {children}
          </a>
        ) : (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      table: ({ children }) => (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      ),
      pre: ({ node, children }) => {
        const code = node?.children?.[0];
        if (code && code.type === "element" && code.tagName === "code") {
          const classes = (code.properties?.className as string[] | undefined) ?? [];
          if (classes.includes("language-mermaid")) {
            const text = code.children.map((c) => (c.type === "text" ? c.value : "")).join("");
            return <MermaidBlock code={text.trim()} />;
          }
        }
        return <pre>{children}</pre>;
      },
    }),
    [],
  );

  return (
    <div className="prd-doc">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </div>
  );
}

export const MarkdownView = memo(MarkdownViewInner);

/** The document's top-level sections, for a contents rail. */
export function outline(markdown: string): { id: string; title: string }[] {
  return [...markdown.matchAll(/^## (.+)$/gm)]
    .map((m) => m[1].trim())
    .map((title) => ({ id: headingSlug(title), title }));
}
