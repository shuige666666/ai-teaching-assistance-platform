"use client";

import { useState, type TextareaHTMLAttributes } from "react";

/** 按行拆分并去掉空行，得到提交给服务端的列表。 */
export function parseLines(text: string) {
  return text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function sameList(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string[];
  onChange: (next: string[]) => void;
};

/**
 * “每行一项”的列表输入框。
 * 输入框保留用户正在编辑的原文（包括刚敲出的换行、行尾空格和空行），只把解析后的列表交给上层；
 * 若列表被外部改写（与当前原文解析结果不同），再用外部值重置原文。
 */
export function LineListTextarea({ value, onChange, ...props }: Props) {
  const [text, setText] = useState(() => value.join("\n"));
  const [syncedValue, setSyncedValue] = useState(value);

  if (value !== syncedValue) {
    setSyncedValue(value);
    if (!sameList(parseLines(text), value)) setText(value.join("\n"));
  }

  return (
    <textarea
      {...props}
      value={text}
      onChange={(event) => {
        const nextText = event.target.value;
        setText(nextText);
        const next = parseLines(nextText);
        // 只改了空行或行尾空格时列表不变，不必标记修改。
        if (!sameList(next, value)) onChange(next);
      }}
    />
  );
}
