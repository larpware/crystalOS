import { useCallback, useState } from "react";
import { Icon } from "@/icons/Icon";
import { parseMarkdown, type Block, type Inline } from "./markdown";

/* ==========================================================================
   Crystal AI — the markdown React renderer

   Maps the parser's typed tree to elements. No dangerouslySetInnerHTML
   anywhere: an AI answer that quotes a web page renders as text, because the
   parser never produces HTML in the first place.

   Code blocks get a copy button because the single most common thing a person
   does with an AI answer is take the code out of it.
   ========================================================================== */

function InlineView({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((node, index) => {
        switch (node.kind) {
          case "text":
            return <span key={index}>{node.text}</span>;
          case "code":
            return (
              <code key={index} className="cr-ai-md__code">
                {node.code}
              </code>
            );
          case "strong":
            return (
              <strong key={index}>
                <InlineView inlines={node.content} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <InlineView inlines={node.content} />
              </em>
            );
          case "del":
            return (
              <del key={index}>
                <InlineView inlines={node.content} />
              </del>
            );
          case "link":
            return (
              <a
                key={index}
                href={node.href}
                target="_blank"
                rel="noreferrer noopener"
                className="cr-ai-md__link"
              >
                <InlineView inlines={node.label} />
                <Icon name="external" size={11} />
              </a>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => setCopied(false));
  }, [code]);

  return (
    <div className="cr-ai-md__pre">
      <div className="cr-ai-md__pre-bar">
        <span className="cr-ai-md__pre-lang">{lang || "code"}</span>
        <button type="button" className="cr-ai-md__copy" onClick={copy}>
          <Icon name={copied ? "check" : "copy"} size={12} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "heading": {
      const Tag = (`h${block.level}` as const);
      return (
        <Tag className={`cr-ai-md__h cr-ai-md__h--${block.level}`}>
          <InlineView inlines={block.content} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p>
          <InlineView inlines={block.content} />
        </p>
      );
    case "code":
      return <CodeBlock lang={block.lang} code={block.code} />;
    case "quote":
      return (
        <blockquote className="cr-ai-md__quote">
          <InlineView inlines={block.content} />
        </blockquote>
      );
    case "list":
      return block.ordered ? (
        <ol className="cr-ai-md__list">
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineView inlines={item} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="cr-ai-md__list">
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineView inlines={item} />
            </li>
          ))}
        </ul>
      );
    case "hr":
      return <hr className="cr-ai-md__hr" />;
    default:
      return null;
  }
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="cr-ai-md">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}
