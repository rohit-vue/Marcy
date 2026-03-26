const MAX_BUBBLES = 3;

export function splitIntoMessages(text: string): string[] {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return [];
  }

  if (isShortSingleSentence(normalized)) {
    return [normalized];
  }

  const rawParts = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (rawParts.length <= 1) {
    return [normalized];
  }

  const merged: string[] = [];
  for (const part of rawParts) {
    if (merged.length === 0) {
      merged.push(part);
      continue;
    }

    if (part.length < 18 || wordCount(part) < 4) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${part}`;
      continue;
    }

    merged.push(part);
  }

  if (merged.length > MAX_BUBBLES) {
    const head = merged.slice(0, MAX_BUBBLES - 1);
    const tail = merged.slice(MAX_BUBBLES - 1).join(" ");
    return [...head, tail];
  }

  return merged;
}

function isShortSingleSentence(text: string): boolean {
  if (text.length < 80 && wordCount(text) <= 14) {
    return true;
  }
  const sentenceCount = (text.match(/[.!?]/g) ?? []).length;
  return sentenceCount <= 1;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
