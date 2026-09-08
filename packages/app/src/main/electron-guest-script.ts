const QUERY_HELPER = `function spyglassQuery(selector) {
  const hops = String(selector).split(' >> ').map((part) => part.trim()).filter(Boolean);
  let root = document;
  for (let i = 0; i < hops.length - 1; i += 1) {
    const host = spyglassQueryDeep(root, hops[i]);
    if (host == null || host.contentDocument == null) {
      return null;
    }
    root = host.contentDocument;
  }
  return spyglassQueryDeep(root, hops[hops.length - 1] ?? selector);
}
function spyglassQueryDeep(root, selector) {
  if (selector.startsWith('xpath=')) {
    const found = root.evaluate(
      selector.slice(6),
      root,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
    return found;
  }
  const role = /^role=([^\\[]+)(?:\\[name="([^"]*)"\\])?$/.exec(selector);
  if (role) {
    const nodes = root.querySelectorAll('*');
    for (const node of nodes) {
      const name = (node.getAttribute('aria-label') || node.textContent || '').trim();
      const computed = (node.getAttribute('role') || node.tagName).toLowerCase();
      if (computed === role[1].toLowerCase() && (!role[2] || name === role[2])) {
        return node;
      }
    }
  }
  try {
    const direct = root.querySelector(selector);
    if (direct) {
      return direct;
    }
  } catch {
    // invalid CSS — try shadow pierce below
  }
  const walk = root.querySelectorAll('*');
  for (const node of walk) {
    if (node.shadowRoot) {
      const nested = spyglassQueryDeep(node.shadowRoot, selector);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}`;

/** Wrap guest scripts so top-level `return` is valid in executeJavaScript. */
export function guestScript(body: string): string {
  return `(() => {\n${QUERY_HELPER}\n${body}\n})()`;
}
