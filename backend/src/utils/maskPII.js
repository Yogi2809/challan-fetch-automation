/**
 * PII masking utility for Playwright screenshots.
 *
 * Injects absolutely-positioned black rectangles over every element matching
 * the given CSS selectors, takes a screenshot, then removes all masks.
 * This prevents Challan Number, Notice Number, Registration Number,
 * Chassis/Engine Number from being visible in any uploaded proof image.
 */

/**
 * Cover PII elements with black boxes. Returns a cleanup function.
 * Call cleanup() after taking the screenshot.
 *
 * @param {import('playwright').Page} page
 * @param {string[]} selectors  CSS selectors of elements to redact
 * @returns {Promise<() => Promise<void>>} cleanup function
 */
export async function applyPIIMasks(page, selectors) {
  await page.evaluate((sels) => {
    sels.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const rect = el.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        const mask = document.createElement('div');
        mask.className = '__pii_mask__';
        mask.style.cssText = [
          'position:absolute',
          `left:${Math.round(rect.left + window.scrollX)}px`,
          `top:${Math.round(rect.top  + window.scrollY)}px`,
          `width:${Math.round(rect.width)}px`,
          `height:${Math.round(rect.height)}px`,
          'background:#000000',
          'z-index:2147483647',
          'pointer-events:none',
        ].join(';');
        document.body.appendChild(mask);
      });
    });
  }, selectors);

  return async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.__pii_mask__').forEach(el => el.remove());
    });
  };
}

/**
 * Mask any visible element whose trimmed text content exactly matches one of
 * the given string values. Useful for masking vehicle numbers, case numbers,
 * chassis digits etc. that appear as plain text anywhere on the page.
 *
 * Returns a cleanup function — call it after taking the screenshot.
 *
 * @param {import('playwright').Page} page
 * @param {string[]} textValues  Exact string values to redact (case-sensitive)
 * @returns {Promise<() => Promise<void>>} cleanup function
 */
export async function applyPIIMasksByText(page, textValues) {
  await page.evaluate((values) => {
    const set = new Set(values.map(v => v.trim()).filter(Boolean));
    if (!set.size) return;

    // Walk every DOM element; mask leaf-ish nodes whose visible text matches
    const allEls = document.querySelectorAll('*');
    allEls.forEach(el => {
      // Only target elements with no element children (leaves) or anchors/spans
      const hasElementChild = Array.from(el.children).some(c =>
        c.nodeType === Node.ELEMENT_NODE && c.tagName !== 'BR'
      );
      if (hasElementChild && !['A', 'SPAN', 'BUTTON', 'LABEL'].includes(el.tagName)) return;

      const text = (el.textContent || '').trim();
      if (!set.has(text)) return;

      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const mask = document.createElement('div');
      mask.className = '__pii_mask__';
      mask.style.cssText = [
        'position:absolute',
        `left:${Math.round(rect.left + window.scrollX)}px`,
        `top:${Math.round(rect.top  + window.scrollY)}px`,
        `width:${Math.round(rect.width)}px`,
        `height:${Math.round(rect.height)}px`,
        'background:#000000',
        'z-index:2147483647',
        'pointer-events:none',
      ].join(';');
      document.body.appendChild(mask);
    });
  }, textValues);

  return async () => {
    await page.evaluate(() => {
      document.querySelectorAll('.__pii_mask__').forEach(el => el.remove());
    });
  };
}
