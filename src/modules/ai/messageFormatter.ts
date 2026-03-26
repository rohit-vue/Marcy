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
    const capped = [...head, tail];
    const target = pickTargetBubbleCount(capped.length);
    return collapseToTarget(capped, target);
  }

  const target = pickTargetBubbleCount(merged.length);
  return collapseToTarget(merged, target);
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

function pickTargetBubbleCount(maxAvailable: number): number {
  if (maxAvailable <= 1) {
    return 1;
  }
  if (maxAvailable === 2) {
    return Math.random() < 0.45 ? 1 : 2;
  }

  // For 3+ fragments (already capped to 3), vary naturally:
  // mostly 2, sometimes 3, occasionally 1.
  const roll = Math.random();
  if (roll < 0.2) {
    return 1;
  }
  if (roll < 0.75) {
    return 2;
  }
  return Math.min(3, maxAvailable);
}

function collapseToTarget(parts: string[], targetCount: number): string[] {
  if (parts.length <= targetCount) {
    return parts;
  }

  const collapsed = [...parts];
  while (collapsed.length > targetCount) {
    const right = collapsed.pop();
    if (!right) {
      break;
    }
    const left = collapsed.pop() ?? "";
    collapsed.push(`${left} ${right}`.trim());
  }

  return collapsed;
}
