import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { compile } from '@tailwindcss/node';
import { ProjectOverview } from '../src/components/projects/ProjectOverview';

// Synthetic content only. No server, database, credentials or provider access.
const rendered = renderToStaticMarkup(<ProjectOverview project={{
  id: 'synthetic-mobile-project', name: 'Project', project_type: 'production', status: 'active',
  description: 'https://example.test/' + 'a'.repeat(800), location_name: 'L'.repeat(400),
}} />);
// --baseline reproduces the pre-fix layout without changing source files.
const markup = process.argv.includes('--baseline')
  ? rendered.replaceAll('min-w-0 ', '').replaceAll('break-words ', '')
  : rendered;
const candidates = [...markup.matchAll(/class="([^"]+)"/g)].flatMap(m => m[1].split(' '));
const compiler = await compile('@import "tailwindcss";', { base: process.cwd(), onDependency: () => {} });
const css = compiler.build(candidates);
console.log('Compiled synthetic fixture CSS');
const browser = await chromium.launch({ headless: true, timeout: 10000 });
try {
  const page = await browser.newPage();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(`<style>${css}</style><main style="padding:24px">${markup}</main>`);
    const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    if (sizes.content > sizes.viewport) throw new Error(`Overflow at ${width}: ${JSON.stringify(sizes)}`);
    console.log(`PASS ${width}px: ${sizes.content}px content`);
  }
} finally { await browser.close(); }
