"use client";
import React from "react";

/**
 * Лёгкое форматирование описаний оповещений.
 * Поддерживается: **жирный**, *курсив*, `код`, [текст](https://…),
 * строки "- " — маркированный список, пустые строки — абзацы.
 *
 * Безопасно по построению: HTML экранируется, узлы строятся через React,
 * ссылки разрешены только http(s) — javascript: и подобное отбрасывается.
 */

const INLINE_RE =
  /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/)[^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(INLINE_RE);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="bg-[#1a1a1a] border border-[#333] rounded px-1 font-mono text-[10px] text-[#ffd479]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]\n]+)\]\(((?:https?:\/\/)[^)\s]+)\)$/.exec(part);
    if (link) {
      return (
        <a
          key={key}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#7db9ff] underline hover:text-[#a8d0ff]"
        >
          {link[1]}
        </a>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

/** Полное описание: абзацы, списки, строчное форматирование. */
export function renderAlertBody(full: string): React.ReactNode {
  const lines = full.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const idx = blocks.length;
    blocks.push(
      <p key={`p-${idx}`} className="mb-1.5 last:mb-0">
        {para.map((ln, li) => (
          <React.Fragment key={li}>
            {li > 0 && <br />}
            {renderInline(ln, `p-${idx}-${li}`)}
          </React.Fragment>
        ))}
      </p>,
    );
    para = [];
  };

  const flushList = () => {
    if (!list.length) return;
    const idx = blocks.length;
    blocks.push(
      <ul key={`ul-${idx}`} className="list-disc pl-5 mb-1.5 space-y-0.5 marker:text-[#666]">
        {list.map((item, li) => (
          <li key={li}>{renderInline(item, `ul-${idx}-${li}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const bullet = /^(?:[-•]|\d+[.)])\s+(.*)$/.exec(line.trim());
    if (bullet) {
      flushPara();
      list.push(bullet[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return <>{blocks}</>;
}

/**
 * Полоска и однострочные места: маркеры разметки убираем,
 * [текст](ссылка) превращается в текст.
 */
export function stripAlertMarkup(s: string): string {
  return s
    .replace(/\[([^\]\n]+)\]\((?:https?:\/\/)[^)\s]+\)/g, "$1")
    .replace(/(\*\*|`)/g, "")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1$2");
}
