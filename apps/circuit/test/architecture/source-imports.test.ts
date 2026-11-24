import { describe, expect, it } from 'vitest';

import { readImports, stripComments } from './source-imports.js';

const specifiers = (source: string): string[] =>
  readImports(source).imports.map((ref) => ref.specifier);

describe('readImports', () => {
  it('reads every static form, type-only and multi-line included', () => {
    const source = [
      "import a from 'default-import';",
      "import * as b from 'namespace-import';",
      "import type { C } from 'type-import';",
      'import {',
      '  d,',
      '  e,',
      "} from 'multi-line-import';",
      "import 'side-effect-import';",
      "export * from 'export-star';",
      "export { f } from 'export-named';",
      "import data from './data.json' with { type: 'json' };",
    ].join('\n');

    expect(specifiers(source)).toEqual([
      'default-import',
      'namespace-import',
      'type-import',
      'multi-line-import',
      'side-effect-import',
      'export-star',
      'export-named',
      './data.json',
    ]);
  });

  it('reads dynamic imports, type queries and require calls with literal targets', () => {
    const source = [
      "const a = await import('dynamic-import');",
      'const b = await import(`template-import`);',
      "type C = typeof import('type-query-import');",
      "const d = require('required');",
    ].join('\n');

    expect(readImports(source)).toEqual({
      imports: [
        { specifier: 'dynamic-import', kind: 'dynamic' },
        { specifier: 'template-import', kind: 'dynamic' },
        { specifier: 'type-query-import', kind: 'dynamic' },
        { specifier: 'required', kind: 'require' },
      ],
      computed: 0,
    });
  });

  it('counts imports whose target is computed', () => {
    const source = [
      'const a = await import(name);',
      'const b = await import(`./${name}.js`);',
      'const c = require(path);',
    ].join('\n');

    expect(readImports(source)).toEqual({ imports: [], computed: 3 });
  });

  it('ignores commented-out imports', () => {
    const source = [
      "// import a from 'line-comment';",
      "/* import b from 'block-comment'; */",
      '/**',
      " * import c from 'doc-comment';",
      ' */',
      "import d from 'real-import';",
    ].join('\n');

    expect(specifiers(source)).toEqual(['real-import']);
  });

  it('does not treat // inside a string as a comment', () => {
    const source = [
      "const url = 'https://example.test/a';",
      "import a from 'after-the-url';",
    ].join('\n');

    expect(specifiers(source)).toEqual(['after-the-url']);
  });

  it('reports a repeated specifier once', () => {
    const source = ["import type { A } from 'same';", "import { b } from 'same';"].join('\n');

    expect(specifiers(source)).toEqual(['same']);
  });

  it('does not mistake Array.from or a variable named from for an import', () => {
    const source = ["const a = Array.from('abc');", "const from = 'not-an-import';"].join('\n');

    expect(readImports(source)).toEqual({ imports: [], computed: 0 });
  });
});

describe('stripComments', () => {
  it('keeps line breaks and string contents', () => {
    const source = "a; // note\nb = '/* not a comment */'; /* gone\n */ c;";

    expect(stripComments(source)).toBe("a; \nb = '/* not a comment */';        \n    c;");
  });
});
