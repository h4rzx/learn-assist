(() => {
  const BLOCKED_SELECTORS = [
    "script",
    "style",
    "noscript",
    "svg",
    "canvas",
    "nav",
    "footer",
    "header",
    "aside",
    "[role='navigation']",
    "[role='banner']",
    "[role='contentinfo']",
    "button",
    "input",
    "select",
    "textarea"
  ];

  const pageTitle = document.title || "";
  const selectionText = cleanText(String(getSelection()?.toString() || ""));
  const selectionCandidate = selectionText.length >= 80
    ? {
      root: null,
      mode: "selection",
      score: 100000 + selectionText.length,
      text: selectionText
    }
    : null;

  const rootCandidate = selectionCandidate || findBestReadingRoot();
  const text = cleanText(rootCandidate.text || "").slice(0, 65000);
  const headings = collectHeadings(rootCandidate.root, text);
  const lessonTitle = detectLessonTitle(headings, text, pageTitle);
  const fingerprint = hashText(`${lessonTitle}\n${text.slice(0, 5000)}`);

  return {
    url: location.href,
    storageKey: `${location.origin}${location.pathname}?learnAssist=${fingerprint}`,
    title: lessonTitle || pageTitle,
    pageTitle,
    headings,
    text,
    fingerprint,
    captureMode: rootCandidate.mode,
    captureScore: rootCandidate.score,
    debug: {
      frameUrl: location.href,
      mode: rootCandidate.mode,
      score: rootCandidate.score,
      textLength: text.length,
      preview: text.slice(0, 900)
    },
    capturedAt: new Date().toISOString()
  };

  function findBestReadingRoot() {
    const candidates = new Map();

    for (const selector of ["main", "article", "[role='main']", ".ebook", ".book", ".reader", ".content", ".chapter", ".lesson"]) {
      for (const node of document.querySelectorAll(selector)) {
        addCandidate(candidates, node, `selector:${selector}`);
      }
    }

    for (const point of sampleReadingPoints()) {
      let node = document.elementFromPoint(point.x, point.y);
      while (node && node !== document.body && node.nodeType === Node.ELEMENT_NODE) {
        addCandidate(candidates, node, "viewport-center");
        node = node.parentElement;
      }
    }

    addCandidate(candidates, document.body, "body-fallback");

    const scored = Array.from(candidates.values())
      .map(scoreCandidate)
      .filter((candidate) => candidate.text.length >= 80)
      .sort((a, b) => b.score - a.score);

    return scored[0] || {
      root: document.body,
      mode: "body-fallback-empty",
      score: 0,
      text: visibleText(document.body)
    };
  }

  function sampleReadingPoints() {
    const xs = [0.42, 0.5, 0.58, 0.66, 0.74].map((ratio) => Math.floor(window.innerWidth * ratio));
    const ys = [0.22, 0.34, 0.46, 0.58, 0.7].map((ratio) => Math.floor(window.innerHeight * ratio));
    return xs.flatMap((x) => ys.map((y) => ({ x, y })));
  }

  function addCandidate(candidates, node, mode) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE || isBlocked(node) || !isVisibleElement(node)) {
      return;
    }

    const rect = node.getBoundingClientRect();
    if (rect.width < 220 || rect.height < 80) {
      return;
    }

    if (!candidates.has(node)) {
      candidates.set(node, { root: node, mode });
    }
  }

  function scoreCandidate(candidate) {
    const root = candidate.root;
    const rect = root.getBoundingClientRect();
    const text = visibleText(root);
    const lower = text.toLowerCase();
    const textLength = text.length;
    const hasLessonLanguage = /(sql|database|select|ddl|dml|exam|query|table|relationship|oracle)/i.test(text);
    const navPenalty =
      countMatches(lower, "bite-size lessons") * 4000 +
      countMatches(lower, "my library") * 3000 +
      countMatches(lower, "resume") * 1200 +
      countMatches(lower, "cards quiz labs") * 1200 +
      countMatches(lower, "previous") * 600 +
      countMatches(lower, "next") * 600;
    const tooBroadPenalty = root === document.body ? 7000 : 0;
    const centerBonus = rect.left > window.innerWidth * 0.25 ? 1500 : 0;
    const sizePenalty = textLength > 55000 ? 4000 : 0;
    const titleBonus = /^\s*\d+(\.\d+)?\s+/m.test(text) ? 2500 : 0;
    const lessonBonus = hasLessonLanguage ? 1200 : 0;
    const score = Math.min(textLength, 20000) + centerBonus + titleBonus + lessonBonus - navPenalty - tooBroadPenalty - sizePenalty;

    return {
      ...candidate,
      score,
      text
    };
  }

  function visibleText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const value = node.textContent || "";
        if (!value.trim() || value.trim().length < 2) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        if (!parent || isBlocked(parent) || !isVisibleElement(parent)) {
          return NodeFilter.FILTER_REJECT;
        }

        const rect = getTextRect(node);
        if (!rect || rect.width === 0 || rect.height === 0) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const chunks = [];
    while (walker.nextNode()) {
      chunks.push(walker.currentNode.textContent);
    }

    return cleanText(chunks.join(" "));
  }

  function collectHeadings(root, text) {
    const headingRoot = root || document;
    const headings = Array.from(headingRoot.querySelectorAll?.("h1,h2,h3,h4") || [])
      .filter(isVisibleElement)
      .filter((node) => !isBlocked(node))
      .map((node) => cleanText(node.textContent || ""))
      .filter(Boolean)
      .slice(0, 20);

    if (headings.length) {
      return headings;
    }

    return text
      .split("\n")
      .filter((line) => /^\d+(\.\d+)?\s+/.test(line))
      .slice(0, 5);
  }

  function getTextRect(node) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    range.detach();
    return rect;
  }

  function isBlocked(node) {
    return Boolean(node.closest(BLOCKED_SELECTORS.join(",")));
  }

  function isVisibleElement(node) {
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function cleanText(value) {
    return String(value)
      .replace(/\s+/g, " ")
      .replace(/(\.|\?|!)\s+/g, "$1\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 2)
      .filter((line) => !/^(Lessons|Resume|Bite-size lessons|Cards|Quiz|Labs|Previous|Next|Go Back|Close|My Library)$/i.test(line))
      .join("\n");
  }

  function detectLessonTitle(headings, text, fallback) {
    const heading = headings.find((item) => /^\d+(\.\d+)?\s+/.test(item)) || headings[0];
    if (heading) {
      return heading.slice(0, 140);
    }

    const line = text.split("\n").find((item) => /^\d+(\.\d+)?\s+/.test(item));
    if (line) {
      return line.slice(0, 140);
    }

    return fallback;
  }

  function countMatches(value, needle) {
    return value.split(needle).length - 1;
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
})();
