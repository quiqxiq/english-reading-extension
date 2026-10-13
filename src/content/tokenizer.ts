import { StorageService } from './storage';

const EXCLUDED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'BUTTON',
  'CODE',
  'PRE',
  'SVG',
  'CANVAS',
  'IFRAME',
  'AUDIO',
  'VIDEO',
]);

export interface TokenizeResult {
  totalWords: number;
}

export class DOMTokenizer {
  private static WORD_REGEX = /\b([a-zA-Z]+(?:'[a-zA-Z]+)?)\b/g;

  /**
   * Finds the sentence surrounding the target word position.
   */
  static extractContextSentence(fullText: string, wordIndex: number): string {
    // Find boundaries of previous sentence (. ! ? or start of text)
    const beforeText = fullText.slice(0, wordIndex);
    const afterText = fullText.slice(wordIndex);

    const prevMatch = beforeText.match(/[.!?]\s+([^.!?]*)$/);
    const startIdx = prevMatch ? beforeText.length - prevMatch[1].length : 0;

    const nextMatch = afterText.match(/^([^.!?]*[.!?])/);
    const endIdx = nextMatch ? wordIndex + nextMatch[1].length : fullText.length;

    const sentence = fullText.slice(startIdx, endIdx).replace(/\s+/g, ' ').trim();
    return sentence.length > 5 ? sentence : fullText.slice(Math.max(0, wordIndex - 50), Math.min(fullText.length, wordIndex + 50)).trim();
  }

  /**
   * Wraps words in readable text nodes into interactive elements.
   */
  static async tokenizeReadableNodes(root: HTMLElement = document.body): Promise<TokenizeResult> {
    const vocabMap = await StorageService.getVocabMap();
    let wordCount = 0;

    // Collect all eligible text nodes
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (EXCLUDED_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('#eir-shadow-host') || parent.closest('.eir-word')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (!node.textContent || node.textContent.trim().length === 0) {
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let currentNode = walker.nextNode();
    while (currentNode) {
      textNodes.push(currentNode as Text);
      currentNode = walker.nextNode();
    }

    // Process each text node
    for (const textNode of textNodes) {
      const parent = textNode.parentNode;
      if (!parent) continue;

      const fullText = textNode.textContent || '';
      if (!this.WORD_REGEX.test(fullText)) continue;
      this.WORD_REGEX.lastIndex = 0;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = this.WORD_REGEX.exec(fullText)) !== null) {
        const matchedWord = match[1];
        const matchStart = match.index;
        const matchEnd = matchStart + matchedWord.length;

        // Add text preceding the matched word
        if (matchStart > lastIndex) {
          fragment.appendChild(document.createTextNode(fullText.slice(lastIndex, matchStart)));
        }

        const lemma = matchedWord.toLowerCase();
        const status = vocabMap[lemma] || 'unknown';
        const contextSentence = this.extractContextSentence(fullText, matchStart);

        const span = document.createElement('span');
        span.className = `eir-word eir-status-${status}`;
        span.textContent = matchedWord;
        span.dataset.eirWord = lemma;
        span.dataset.eirOriginal = matchedWord;
        span.dataset.eirSentence = contextSentence;

        fragment.appendChild(span);
        lastIndex = matchEnd;
        wordCount++;
      }

      // Add remaining text after last matched word
      if (lastIndex < fullText.length) {
        fragment.appendChild(document.createTextNode(fullText.slice(lastIndex)));
      }

      parent.replaceChild(fragment, textNode);
    }

    return { totalWords: wordCount };
  }

  /**
   * Restores all .eir-word elements back to plain text when Reading Mode is disabled.
   */
  static unwrapAllWords(root: HTMLElement = document.body): void {
    const words = root.querySelectorAll('.eir-word');
    words.forEach((span) => {
      const parent = span.parentNode;
      if (parent) {
        const textNode = document.createTextNode(span.textContent || '');
        parent.replaceChild(textNode, span);
        parent.normalize();
      }
    });
  }

  /**
   * Updates status classes for all occurrences of a word on the page.
   */
  static updateWordStatusOnPage(word: string, newStatus: string): void {
    const lemma = word.toLowerCase().trim();
    const elements = document.querySelectorAll(`[data-eir-word="${lemma}"]`);
    elements.forEach((el) => {
      el.className = `eir-word eir-status-${newStatus}`;
    });
  }
}
