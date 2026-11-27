import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GIF_HEIGHT, GIF_WIDTH } from './shots/board-gif.ts';
import { STORYBOARD_DIR, STORY_FRAMES } from './shots/board-storyboard.ts';

// F6, in place of the video: docs/recorrido.md tells the circuit frame by frame with the stills
// `npm run board:storyboard` writes. Held here so that a frame the script adds, renames or drops
// cannot leave the page showing a missing picture, or a picture nobody describes.

const PAGE = fileURLToPath(new URL('../../../docs/recorrido.md', import.meta.url));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Ten stills at 1280 × 720 weigh about 1.6 MB; four times that would slow the page down. */
const FRAME_MAX_BYTES = 400_000;

describe('F6 · the storyboard in place of the video', () => {
  const files = readdirSync(STORYBOARD_DIR).sort();

  it('has one PNG per frame of the script, and nothing else', () => {
    expect(files).toEqual(STORY_FRAMES.map((frame) => `${frame.name}.png`));
  });

  it.each(STORY_FRAMES.map((frame) => frame.name))('%s is a PNG at the GIF size, not too heavy', (name) => {
    const bytes = readFileSync(join(STORYBOARD_DIR, `${name}.png`));
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    // IHDR: width and height, big endian, right after its length and type.
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([GIF_WIDTH, GIF_HEIGHT]);
    expect(bytes.length).toBeLessThanOrEqual(FRAME_MAX_BYTES);
  });

  it('the page shows every frame, in order, each once', () => {
    const shown = [...readFileSync(PAGE, 'utf8').matchAll(/\]\(media\/recorrido\/([^)]+)\.png\)/g)].map((match) => match[1]);
    expect(shown).toEqual(STORY_FRAMES.map((frame) => frame.name));
  });
});
